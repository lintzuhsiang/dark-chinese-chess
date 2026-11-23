"""Spatial action gathering over the existing public-v1 schema."""
import hashlib
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.distributions import Categorical

from .cnn import split_public_features, PUBLIC_SIDE_DIM
from .geometry_head import action_geometry


def runtime_hash():
    paths = [Path(__file__).with_name(name) for name in
             ('e3.py','train.py','runtime.py','cnn.py','relational_head.py','geometry_head.py',
              'environment.ts','server.ts','learning_methods.py')]
    return hashlib.sha256(b''.join(p.read_bytes() for p in paths)).hexdigest()


def rollout_streams(seed, rollout):
    return [np.random.default_rng(np.random.SeedSequence([seed, rollout, purpose, 0xE3]))
            for purpose in range(4)]


def scorer(width):
    head = nn.Sequential(nn.Linear(width, 48), nn.Tanh(), nn.Linear(48, 1))
    nn.init.orthogonal_(head[-1].weight, gain=.01)
    nn.init.zeros_(head[-1].bias)
    return head


class SpatialGather(nn.Module):
    def __init__(self, architecture, input_dim=2163):
        super().__init__()
        if architecture not in ('e3_joint','e3_gate') or input_dim != 2163:
            raise ValueError('Invalid E3 configuration')
        self.config = dict(architecture=architecture, input_dim=input_dim)
        self.board = nn.Sequential(nn.Conv2d(49,12,1), nn.Tanh(),
                                   nn.Conv2d(12,12,3,padding=1), nn.Tanh())
        self.context = nn.Sequential(nn.Linear(PUBLIC_SIDE_DIM+12,64),nn.Tanh())
        self.move = scorer(64+24+7)
        self.flip = scorer(64+12+7)
        self.critic = nn.Linear(64,1)
        self.register_buffer('geometry',action_geometry(),persistent=False)
        self.gate = None
        if architecture == 'e3_gate':
            with torch.random.fork_rng(devices=[]):
                self.gate = nn.Linear(64,2)
                nn.init.zeros_(self.gate.weight)
                nn.init.zeros_(self.gate.bias)

    def encode_state(self, features):
        board, side = split_public_features(features)
        cells = self.board(board).flatten(2).transpose(1,2)
        return cells,self.context(torch.cat((side,cells.mean(1)),1))

    def forward(self, features, masks):
        if masks.dtype!=torch.bool or masks.shape!=(len(features),1056) or not masks.any(1).all():
            raise ValueError('Expected nonempty 1056-wide legal masks')
        cells,h = self.encode_state(features)
        logits = h.new_full(masks.shape,-torch.inf)
        fr, target = masks[:,:32].nonzero(as_tuple=True)
        mr, move = masks[:,32:].nonzero(as_tuple=True)
        flip_logits = self.flip(torch.cat((h[fr],cells[fr,target],self.geometry[target]),1)).flatten()
        move_logits = self.move(torch.cat((h[mr],cells[mr,move//32],cells[mr,move%32],self.geometry[32+move]),1)).flatten()
        if self.gate is not None:
            # Multiplying the conditional softmax by softmax(logsumexp_g + delta_g)
            # cancels logsumexp_g. Adding delta to each legal logit implements the
            # exact joint distribution and never normalizes an empty group.
            delta = self.gate(h)
            flip_logits = flip_logits + delta[fr,0]
            move_logits = move_logits + delta[mr,1]
        logits[fr,target] = flip_logits
        logits[mr,32+move] = move_logits
        return Categorical(logits=logits),self.critic(h).flatten()


def file_digest(path, length=None):
    with path.open('rb') as f:
        if length is None:
            digest = hashlib.sha256()
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                digest.update(chunk)
            return digest.hexdigest()
        digest=hashlib.sha256()
        while length:
            part=f.read(min(length,1024*1024))
            if not part:
                raise ValueError(f'Truncated training log {path}')
            digest.update(part)
            length-=len(part)
        return digest.hexdigest()


def record_boundary(path,state):
    from .runtime import write_json
    logs={}
    for name,key in [('training-games.jsonl','games_offset'),('metrics.jsonl','metrics_offset')]:
        length=state.get(key,0)
        if length:
            logs[name]=[length,file_digest(path.parent/name,length)]
    write_json(path.with_suffix('.integrity.json'),dict(checkpoint=file_digest(path),source=runtime_hash(),
               manifest=file_digest(path.parent/'manifest.json'),logs=logs))


def verify_boundary(path,output):
    import json
    record=json.loads(path.with_suffix('.integrity.json').read_text())
    if path.resolve().parent!=output or record['source']!=runtime_hash() or record['checkpoint']!=file_digest(path):
        raise ValueError('E3 checkpoint/source/output binding mismatch')
    if record['manifest']!=file_digest(output/'manifest.json'):
        raise ValueError('E3 original training manifest changed')
    for name,(length,digest) in record['logs'].items():
        if file_digest(output/name,length)!=digest:
            raise ValueError('E3 training log hash mismatch')
