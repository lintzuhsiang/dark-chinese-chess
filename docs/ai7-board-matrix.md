# E2b board matrix v1

本機工程驗收使用 E2b source parent `71d4850a9a89bf8c3fdcbd42e7d49f519717dd7a` 加本次變更。GameCore 為 `973bafe42f66e3414878afb3284e1f54216cbe4d`。本文件中的 seed、machine 與 study ID 由未來核准的 protocol 提供。

| Arm | CLI architecture     | Encoder   | 每一合法 MOVE 的額外輸入 |
| --- | -------------------- | --------- | ------------------------ |
| A   | `e2b-mlp-preboard`   | E2b-L MLP | 當前 board               |
| B   | `e2b-cnn-preboard`   | Exp1 CNN  | 當前 board               |
| C   | `e2b-mlp-afterboard` | E2b-L MLP | 移動後 board             |
| D   | `e2b-cnn-afterboard` | Exp1 CNN  | 移動後 board             |

所有 checkpoint ID 形式為 `public-<CLI architecture>-v1`。A/C 各 335,778 個參數，B/D 各 306,050 個。舊 `e2b_l` 維持 `public-relational-local-mlp128-v1` 與 315,266 個參數。

## Tensor contract

- 輸入為當前 `public-v1 [N,2163]` 與 GameCore legal mask `[N,1056]`。A/C 的 state embedding 維持 `2163→128→128`。B/D 把佔位類別 16 與公開 reveal references 33 依 `row*4+col` 排成 `[N,49,8,4]`；兩層 stride-1、padding-1 的 3×3 Conv，各 32 channels 和 tanh。flatten 的 1,024 維與 inventory、seat/colors、quiet/ply、history 共 595 維經 `595→128` 的 side embedding 串接，再經 `1152→128→128`。四組的 critic 均從當前 128-d embedding 線性輸出 scalar。
- Actor 對每個 legal ID 串接當前 state 128、geometry 7、原盤 source 16、原盤 target 16 和 board projection 32，經 `199→128(tanh)→1`。散回 1,056 欄，非法 logits 為負無限大，合法動作依 temperature 1 取樣。
- 新分支是公開佔位 one-hot `32×16→Linear(512,32)→tanh`。Afterboard 用兩格的確定性變化精確增減投影權重的四個欄向量。兩組 FLIP 一律補 32 個零。References、inventory、history、Chase 和 counters 隨真實 GameCore 步進。CNN 與 MLP 都只在當前局面執行一次 trunk。
- 相同 seed 下四個 actor、board projector 與 scalar value head 的初始參數逐元素相同。共享原 E2b-L 的初始 167 欄，新增 32 欄初始化為零；projector 為一般 Linear 初始化，第一次 backward 先學 scorer 的新欄位。Pre/After 在同 encoder 下初始 logits 一致，之後可分化。CNN 與 MLP 的參數量、計算方式及 state embedding 不同；同 seed 不代表各 encoder 的初始預測相同。每個成員的 board projection 都能表達位置偏好，沒有旋轉等變保證。

## 工程驗收與重現

從含本次實作的 repo root，將 `PY` 設成該機 AI-7 Python interpreter。兩台機器使用同一份 source snapshot。若手上是本次本機交付的 patch，可在乾淨的上述 parent 以 `git apply --check architecture.patch` 及 `git apply architecture.patch` 還原。先核對交付目錄的 `checksums.sha256`。在 M1 本次使用 `/Users/lintzu-ting/Desktop/dark-chinese-chess/experiment/selfplay-zero/.venv/bin/python`。

```sh
"${PY:?set PY to the AI-7 interpreter}" -B -m unittest -v \
  scripts.ai7.tests.test_board_matrix scripts.ai7.tests.test_relational_head \
  scripts.ai7.tests.test_cnn scripts.ai7.tests.test_encoder \
  scripts.ai7.tests.test_geometry_head scripts.ai7.tests.test_learning
for arm in e2b_l e2b-mlp-preboard e2b-cnn-preboard e2b-mlp-afterboard e2b-cnn-afterboard; do
  "$PY" -B -m scripts.ai7.benchmark_board_matrix "$arm" || break
done
```

各 arm 的 benchmark 在獨立 process，以兩個 Torch CPU threads、一個 interop thread 重複公開工程 fixtures。記錄 median、p90、process CPU/wall 及 peak RSS。forward 包含 masked distribution、probabilities 與 value；scorer 包含合法 ID gather 和 scatter；projection 使用已找出的 endpoints。Forward/backward 為固定 batch 的 actor、entropy、value loss，不含 Adam、GameCore 或 IPC。

## Intel 與 M1 未來執行命令

以下是供審核的正式訓練命令。先由 protocol 配給每機 study ID、matched seed 與執行順序。從同一個已核對 SHA 的 source root 執行，在該機同一個 seed 上保留四組；`run_arm` 每次只啟動指定的一組。相同 study、機器、seed、arm 使用同一個輸出路徑，trainer 會拒絕覆寫。工程初始化 fixture seed 2718 不作此分配。

```sh
: "${PY:?}" "${STUDY_ID:?}" "${MACHINE_ID:?m1 or intel}" "${TRAIN_SEED:?approved seed}"
run_arm() {
  local arm="$1"
  local out="$PWD/benchmark-results/ai7-selfplay/$STUDY_ID/$MACHINE_ID-$TRAIN_SEED-$arm"
  AI7_ARTIFACT_ROOT="$out" "$PY" -B -m scripts.ai7.train \
    --output "$out" --architecture "$arm" --seed "$TRAIN_SEED" \
    --learning-method gae_lambda_095 --opponent-mixture standard \
    --until-step-target --max-env-steps 3640000 --checkpoint-every-steps 25000 \
    --batch-games 16 --threads 2 --device cpu --validation-pairs 0 --max-replays 0
}
run_arm e2b-mlp-preboard
run_arm e2b-cnn-preboard
run_arm e2b-mlp-afterboard
run_arm e2b-cnn-afterboard
```

各 run 繼承 terminal +1/0/−1、γ=1、λ=.95、Adam 3e−4、4 epochs、minibatch 256、clip .2、target KL .03。trainer 依既有邏輯記錄 resolved config、source hashes、Core revision 和 checkpoint architecture。中斷時使用相同 source、輸出、機器與 architecture 恢復，將下列 `OUT` 指到該 run 已驗證的目錄。

```sh
AI7_ARTIFACT_ROOT="$OUT" "$PY" -B -m scripts.ai7.train \
  --output "$OUT" --architecture "$ARM" --resume "$OUT/latest.pt"
shasum -a 256 "$OUT/final.pt" "$OUT/manifest.json"
```

通用 evaluator 使用相同 `load_checkpoint`、mask 與 per-game 輸出介面。歷史專用的 `evaluate_shared.py` 另有 baseline 與舊 protocol 的限制。正式 study 應在現有 shared results 平台凍結此次 evaluator 與模型來源（含 `cnn.py`、`board_projection.py`、`relational_head.py`）、配對分工、對手和新 deck manifest，再收錄 final checkpoint SHA。
