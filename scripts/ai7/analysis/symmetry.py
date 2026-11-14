"""Read-only checkpoint evaluation; reserved bank is never loaded here."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import time

import numpy as np
import torch
from scripts.ai7.runtime import ROOT, encode, mask_array, load_checkpoint, seed_all


def rotate_ids(ids):
    ids = np.asarray(ids)
    return np.where(ids < 32, 31 - ids,
                    32 + (31 - (ids - 32) // 32) * 32 + 31 - (ids - 32) % 32)


def intervals(values, indices):
    values = np.asarray(values, dtype=np.float64)
    if not len(values):
        return None
    means = values[indices].mean(axis=1)
    return {'mean': float(values.mean()), 'ci95': np.quantile(means, [.025, .975]).tolist()}


def evaluate(root, phase):
    if phase not in ['stage1', 'stage2']:
        raise ValueError('Reserved bank cannot be evaluated by this tool')
    destination = root / f'{phase}-evaluation.json'
    if destination.exists():
        raise FileExistsError(destination)
    source = root / f'{phase}.json'
    raw = source.read_bytes()
    bank = json.loads(raw)['bank']
    expected = {'early': 5, 'win': 5, 'defense': 10} if phase == 'stage1' else {'win': 200, 'defense': 200}
    assert {k: sum(r['category'] == k for r in bank) for k in expected} == expected
    assert len({r['semanticKey'] for r in bank}) == len(bank)
    observations = [o for row in bank for o in [row['observation'], row['rotated']]]
    features = torch.from_numpy(np.stack([encode(o) for o in observations]))
    masks = torch.from_numpy(mask_array(observations))
    seed_all(7331, threads=2)
    campaign = ROOT / 'benchmark-results/ai7-selfplay/p1p2-comparison/20261114-v1/runs'
    rows, details = [], []
    started = time.monotonic()
    treatments = ['baseline'] if phase == 'stage1' else ['baseline', 'low_lr', 'random_rich']
    for treatment in treatments:
        for seed in [4011, 4023, 4037]:
            run = campaign / f'{treatment}-seed-{seed}'
            paths = [run/'initial.pt', *sorted(run.glob('step-*.pt')), run/'final.pt']
            for path in paths:
                model, checkpoint = load_checkpoint(path)
                model.eval()
                with torch.inference_mode():
                    probabilities = torch.cat([model(x, m)[0].probs for x, m in zip(features.split(128), masks.split(128))]).numpy()
                state_rows = []
                for i, item in enumerate(bank):
                    p, q = probabilities[2*i:2*i+2]
                    legal = item['observation']['legal']
                    tv = float(.5*np.abs(p[legal]-q[rotate_ids(legal)]).sum())
                    category = item['category']
                    target = item['labels']['wins' if category == 'win' else 'safe'] if category != 'early' else []
                    a = float(p[target].sum()) if target else None
                    b = float(q[rotate_ids(target)].sum()) if target else None
                    entry = {'id': item['id'], 'category': category, 'original': a, 'rotated': b,
                             'symmetry_gap': abs(a-b) if a is not None else None,
                             'signed_gap': b-a if a is not None else None,
                             'equivariance_tv': tv, 'uniform': len(target)/len(legal) if target else None}
                    state_rows.append(entry)
                for category in expected:
                    subset = [r for r in state_rows if r['category'] == category]
                    rng = np.random.default_rng(91023)
                    ix = rng.integers(len(subset), size=(4000, len(subset)))
                    summary = {'treatment': treatment, 'seed': seed, 'checkpoint': path.name,
                               'env_steps': checkpoint['env_steps'], 'category': category, 'n': len(subset)}
                    for metric in ['original', 'rotated', 'symmetry_gap', 'signed_gap', 'equivariance_tv', 'uniform']:
                        summary[metric] = intervals([r[metric] for r in subset], ix) if subset[0][metric] is not None else None
                    if category != 'early':
                        summary['orientation_mean'] = intervals([(r['original']+r['rotated'])/2 for r in subset], ix)
                        summary['orientation_min'] = intervals([min(r['original'],r['rotated']) for r in subset], ix)
                    rows.append(summary)
                details.append({'treatment': treatment, 'seed': seed, 'checkpoint': path.name,
                                'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'states': state_rows})
                print(treatment, seed, path.name, flush=True)
    # Pair changes on the same independent game/position; no mirrors counted as new samples.
    changes = []
    for run in details:
        if run['checkpoint'] == 'initial.pt':
            continue
        initial = next(r for r in details if r['treatment'] == run['treatment'] and r['seed'] == run['seed'] and r['checkpoint'] == 'initial.pt')
        for category in ['win', 'defense']:
            pairs = [(a,b) for a,b in zip(initial['states'],run['states']) if a['category'] == category]
            ix = np.random.default_rng(91023).integers(len(pairs), size=(4000,len(pairs)))
            change = {k:run[k] for k in ['treatment','seed','checkpoint']}
            change.update(category=category, n=len(pairs))
            for metric in ['original','rotated','symmetry_gap','equivariance_tv']:
                change[metric] = intervals([b[metric]-a[metric] for a,b in pairs],ix)
            change['orientation_mean'] = intervals([(b['original']+b['rotated']-a['original']-a['rotated'])/2 for a,b in pairs], ix)
            changes.append(change)
    result = {'phase':phase,'bank_sha256':hashlib.sha256(raw).hexdigest(),'seconds':time.monotonic()-started,
              'ci_scope':'Paired position bootstrap conditional on each fixed model and this sampling procedure; training seeds remain separate. Descriptive, no multiplicity correction.',
              'rows':rows,'paired_initial_changes':changes,'details':details}
    destination.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    lines = [f'# {phase} symmetry evaluation', '', result['ci_scope'], '',
             '|Treatment|Seed|Checkpoint|Task|N|Original|Rotated|Abs gap|TV error|',
             '|---|---:|---|---|---:|---:|---:|---:|---:|']
    for r in rows:
        f=lambda key: f"{r[key]['mean']:.4f}" if r[key] else '—'
        lines.append(f"|{r['treatment']}|{r['seed']}|{r['checkpoint']}|{r['category']}|{r['n']}|{f('original')}|{f('rotated')}|{f('symmetry_gap')}|{f('equivariance_tv')}|")
    (root/f'{phase}-evaluation.md').write_text('\n'.join(lines)+'\n')
    with (root/f'{phase}-evaluation.csv').open('w') as out:
        flat = [{**{k:r[k] for k in ['treatment','seed','checkpoint','env_steps','category','n']},
                 **{k:r[k]['mean'] if r[k] else None for k in ['original','rotated','symmetry_gap','signed_gap','equivariance_tv','uniform']}} for r in rows]
        writer=csv.DictWriter(out,fieldnames=list(flat[0])); writer.writeheader(); writer.writerows(flat)


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--phase', choices=['stage1','stage2'], required=True)
    args=parser.parse_args()
    evaluate(args.output, args.phase)
