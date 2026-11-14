"""Read-only inventory, full training summaries, and retrospective replay inference."""
import collections
import hashlib
import json
from pathlib import Path
import numpy as np
import torch
from scripts.ai7.runtime import ROOT, encode, mask_array, load_checkpoint, seed_all


def main():
    output=ROOT/'benchmark-results/ai7-selfplay/existing-records/20261114-v1'
    target=output/'analysis.json'
    if target.exists(): raise FileExistsError(target)
    campaign=ROOT/'benchmark-results/ai7-selfplay/p1p2-comparison/20261114-v1'
    coverage=json.loads((output/'replay-coverage.json').read_text())
    summaries=[]; inventory=[]; scores=[]; provenance={}
    seed_all(741, threads=2)
    def summarize(rows):
        return {'games':len(rows),'wins':sum(r['return']==1 for r in rows),'draws':sum(r['return']==0 for r in rows),
                'losses':sum(r['return']==-1 for r in rows),
                'termination':dict(collections.Counter(r['result']['reason'] for r in rows)),
                'mean_plies':float(np.mean([r['plies'] for r in rows])),
                'mean_reversals':float(np.mean([r['reversals'] for r in rows])),
                'mean_repeated_positions':float(np.mean([r['repetitions'] for r in rows])),
                'mean_hidden_at_end':float(np.mean([r['hidden'] for r in rows]))}
    for run in sorted((campaign/'runs').iterdir()):
        raw=(run/'training-games.jsonl').read_bytes()
        games=[json.loads(line) for line in raw.splitlines()]
        metrics=[json.loads(line) for line in (run/'metrics.jsonl').read_text().splitlines()]
        step_by_update={r['update']:r['env_steps'] for r in metrics}
        checkpoints=[run/'initial.pt',*sorted(run.glob('step-*.pt')),run/'final.pt']
        inventory.append({'run':run.name,'training_games':len(games),'complete_training_replays':sum('archive' in r for r in games),
                          'checkpoints':len(checkpoints),'diagnostic_updates':sum('diagnostics' in r for r in metrics),
                          'total_metric_updates':len(metrics),
                          'sampled_gradient_minibatches':sum(len(r.get('diagnostics',{}).get('gradients',[])) for r in metrics)})
        provenance[str((run/'training-games.jsonl').relative_to(ROOT))]=hashlib.sha256(raw).hexdigest()
        summaries.append({'run':run.name,'scope':'all_training_games',**summarize(games)})
        for q in range(4):
            selected=[r for r in games if min(3,(step_by_update.get(r['update'],3640000)-1)//910000)==q]
            if selected: summaries.append({'run':run.name,'scope':f'quarter_{q+1}_update_end_steps',**summarize(selected)})
        opportunities=[r for r in coverage['opportunities'] if r['run']==run.name]
        if not opportunities: continue
        observations=[r['observation'] for r in opportunities]
        features=torch.from_numpy(np.stack([encode(o) for o in observations]))
        masks=torch.from_numpy(mask_array(observations))
        for path in checkpoints:
            model,meta=load_checkpoint(path);model.eval()
            with torch.inference_mode():
                probs=torch.cat([model(x,m)[0].probs for x,m in zip(features.split(128),masks.split(128))]).numpy()
            values=[]
            for row,p in zip(opportunities,probs):
                values.append({k:row[k] for k in ['game','update','outcome','category','ply','selected','pieces']} |
                              {'target_probability':float(p[row['targets']].sum()),
                               'uniform_probability':len(row['targets'])/len(row['observation']['legal'])})
            scores.append({'run':run.name,'checkpoint':path.name,'env_steps':meta['env_steps'],'positions':values})
    result={'inventory':inventory,'full_summary':summaries,'replay_games':coverage['games'],'checkpoint_scores':scores,
            'source_summary_hashes':provenance,
            'limitations':['Replay sample is four deterministically archived game-0 trajectories per run, not random representative sampling.',
                           'Only fully revealed states are classified; states with hidden pieces are unclassified, not zero opportunities.',
                           'Repeated opportunities from one game are dependent; no position-level independence claim or significance test.',
                           'Old actions are factual; checkpoint probabilities are retrospective on old-policy states, not reconstructed behavior probabilities or causal update effects.',
                           'Quarter membership uses completed-update environment-step totals, not exact per-game step boundaries.',
                           'Self-play training WDL is against changing opponent mixtures, not a fixed strength benchmark.']}
    target.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    lines=['# 現有紀錄與模型的離線分析','','本次沒有訓練、更新權重、重建過去梯度或使用保留確認集。','',
           '## 保存範圍','','|Run|全部訓練局數|完整棋譜|Checkpoints|含診斷的 updates|','|---|---:|---:|---:|---:|']
    for r in inventory: lines.append(f"|{r['run']}|{r['training_games']}|{r['complete_training_replays']}|{r['checkpoints']}|{r['diagnostic_updates']}|")
    lines+=['','## 全部訓練摘要','','以下不是固定對手評估，不能由訓練勝率比較棋力。','','|Run|W|D|L|平均步數|平均往返|平均重複局面|','|---|---:|---:|---:|---:|---:|---:|']
    for r in summaries:
        if r['scope']=='all_training_games':lines.append(f"|{r['run']}|{r['wins']}|{r['draws']}|{r['losses']}|{r['mean_plies']:.1f}|{r['mean_reversals']:.1f}|{r['mean_repeated_positions']:.1f}|")
    lines+=['','## 可重播棋譜中的戰術機會','','僅統計 learner 的決策。勝著與防守互斥；防守只代表避免對手一手終局勝利。','','|Run|棋譜局數|Learner 決策|完全明子決策|勝著機會／實際選對|防守機會／實際選對|','|---|---:|---:|---:|---:|---:|']
    for run in [r['run'] for r in inventory]:
        rows=[r for r in coverage['games'] if r['run']==run]
        total=lambda key:sum(r[key] for r in rows)
        lines.append(f"|{run}|{len(rows)}|{total('learnerDecisions')}|{total('revealedDecisions')}|{total('winOpportunities')} / {total('winChosen')}|{total('defenseOpportunities')} / {total('defenseChosen')}|")
    lines+=['','## 同一批實際訓練局面的 checkpoint 機率','','每格為機會決策的平均機率，不是實戰勝率；同盤內多次出現的局面有相關性。不同 run 使用不同局面，不能當成公平的 treatments 排名。','','|Run|任務|機會數|隨機基準|Initial|0.91M|1.82M|2.73M|Final|','|---|---|---:|---:|---:|---:|---:|---:|---:|']
    for run in [r['run'] for r in inventory]:
        for cat in ['win','defense']:
            rows=[r for r in scores if r['run']==run]
            subset=lambda r:[v for v in r['positions'] if v['category']==cat]
            if not rows or not subset(rows[0]):continue
            b=subset(rows[0]); vals=[f"{100*np.mean([v['target_probability'] for v in subset(r)]):.2f}%" for r in rows]
            lines.append('|'+ '|'.join([run,cat,str(len(b)),f"{100*np.mean([v['uniform_probability'] for v in b]):.2f}%",*vals])+'|')
    lines+=['','## 限制與可用價值','',*[f'- {s}' for s in result['limitations']], '',
            '- 摘要可分析全期終局比例、棋局長度與對手組成；棋譜只支持小樣本覆蓋與具體失誤案例。',
            '- 已保存的 45 個模型可重複評估公共局面、對稱性與交叉對戰，不需要訓練。',
            '- 若要估計全部訓練的戰術覆蓋率，需要更多完整棋譜，或先證明可從保存的完整邊界 checkpoint、RNG 與程式版本確定性重播。不能把 deck seed 當成完整走法紀錄。',
            '- 過去未保存的梯度不能還原成原始測量。詳細診斷只在預先指定 minibatches 取樣，不能聲稱每個更新都有完整因果對齊。']
    (output/'research-review.md').write_text('\n'.join(lines)+'\n')
    print(output)

if __name__=='__main__':main()
