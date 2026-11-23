# Frozen architecture and data flow

Runtime parent 53a54110bb4aa791cc2ee5819e6d8c6fa163bb75, GameCore 973bafe42f66e3414878afb3284e1f54216cbe4d. The parent requires the included E3 patch. Training runtime digest a35c18d8e7a28ba240a36e1e85d49e467f5ecf55feef4218cf7e82b106d5fc24 (file sequence in scripts/ai7/e3.py:13); individual source hashes in SHA256SUMS. File and line references below are relative to source/. The comparison uses the original five predetermined seed triples, each trained for 3.64M transitions.

## Inputs and coordinate conventions

scripts/ai7/runtime.py:89 encodes the observation from the acting seat into [N,2163] float32. In order: 32×16 square-category one-hots, 32×33 public reveal-reference one-hots, 28 hidden/remaining inventory entries divided by five, 2 player and 3 colour one-hots, quiet/60 and ply/4096, and 20×28 padded public event features. All models receive the same Boolean [N,1056] legal mask. Output records follow the Core observation's legal list, which can differ from numerical ID order. FLIP(t)=t. MOVE(s,t)=32+32s+t. Square i has row i//4, column i%4. scripts/ai7/geometry_head.py:11 defines the seven features (MOVE indicator, normalized source and target row/column, normalized displacements; FLIP uses sentinel source).

## Tensor shapes and parameter ownership

| Stage | A (315266 parameters) | B (49623) and C (49753) |
|---|---|---|
| Shared encoding | Flat 2163→128→128, tanh after each affine | scripts/ai7/cnn.py:27 splits board [N,49,8,4] and side [N,595]. Two spatial convolutions, 49→12 kernel 1 padding 0, then 12→12 kernel 3 padding 1. Both stride 1, dilation 1, tanh, no residual connections. Output [N,32,12]. |
| Global context | [N,128] | Mean over 32 cells [N,12] concatenated after side [N,595], affine 607→64 and tanh. |
| MOVE | 128 global + 7 geometry + 16 category at each endpoint, 167→128 tanh→1 | 64 context + 12 source + 12 target + 7 geometry = 95→48 tanh→1. |
| FLIP | Same scorer, 16 zero source channels | Separate weights, 64 context + 12 target + 7 geometry = 83→48 tanh→1. |
| Output | One legal logit per candidate, illegal = −∞, categorical | Same masking. C adds a learned context-dependent bias to each type (64→2), initialized to zero. This equals group softmax(logsumexp within type + correction) times within-type softmax. |
| Value | Shared [N,128]→1 | Shared [N,64]→1. The critic receives no action candidates. |

Forward implementations: scripts/ai7/relational_head.py:39,47,71 and scripts/ai7/runtime.py:114 (A); scripts/ai7/e3.py:25,32,52,57 (B/C). The constructor at runtime.py:138 selects the architecture from checkpoint metadata. The historical BoardCNNPolicy network in cnn.py is not instantiated by B/C. Gate parameters belong only to C. Scorers and value heads are separate; both losses can change the shared trunk. Strict state-dict load and recorded SHA identify each frozen model.

## Receptive field and access to remote threats

For stride one the receptive-field width starts at one and increases by (kernel−1)×dilation per convolution. The final cell therefore sees 1+0+2=3 sites along each axis, clipped at the edges (zero padding). A MOVE reads two such patches, one around each endpoint. All 32 cells also feed the global mean, hence distant board changes have a path into the MOVE/FLIP scorer and critic. Public history and inventory enter separately. Mean pooling can discard configurations; structural reach does not guarantee preservation of a particular cannon relationship. Legal masks independently affect normalized probabilities. A has an unrestricted dense path from every input coordinate.

The effective receptive field depends on weights, state and activation sensitivities. The paired perturbation measures finite differences for one legally generated intervention. It does not estimate a population-wide sensitivity map. Raw-logit differences measure a scorer response without the softmax denominator. Probability differences additionally depend on competing legal moves. No independent linear probe was trained; generalizable threat decodability remains pending.
