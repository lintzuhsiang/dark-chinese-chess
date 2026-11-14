"""Identify archived draws with missed immediate wins; no training or new games."""
import json
from pathlib import Path
from scripts.ai7.runtime import ROOT


def main():
    source=ROOT/'benchmark-results/ai7-selfplay/existing-records/20261114-v1'
    data=json.loads((source/'replay-coverage.json').read_text())
    analysis=json.loads((source/'analysis.json').read_text())
    cases=[]
    for game in data['games']:
        if game['outcome']!=0: continue
        opportunities=[r for r in data['opportunities'] if r['run']==game['run'] and r['game']==game['archive'] and r['category']=='win']
        if not opportunities:continue
        latest=opportunities[-1]
        probabilities=[]
        for score in analysis['checkpoint_scores']:
            if score['run']!=game['run']:continue
            selected=[p for p in score['positions'] if p['game']==game['archive'] and p['ply']==latest['ply'] and p['category']=='win']
            assert len(selected)==1
            probabilities.append({'checkpoint':score['checkpoint'],'probability':selected[0]['target_probability']})
        cases.append({'run':game['run'],'archive':game['archive'],'recorded_update':game['update'],
                      'missed_win_decisions':len(opportunities),'first_ply':opportunities[0]['ply'],
                      'last_ply':latest['ply'],'last_quiet_count':latest['observation']['quiet'],
                      'last_chosen_action':latest['chosen'],'last_winning_actions':latest['targets'],
                      'last_chance_checkpoint_probabilities':probabilities})
    output=ROOT/'benchmark-results/ai7-selfplay/draw-cases/20261114-v1'
    output.mkdir(parents=True,exist_ok=False)
    (output/'cases.json').write_text(json.dumps(cases,indent=2)+'\n')
    lines=['# 錯過立即勝著後和棋：復盤清單','','僅限 36 盤保存棋譜；同盤機會不獨立，沒有修改規則、回饋或訓練。', '',
           '|Run|棋譜|錯過次數|首次 ply|最後 ply|最後 quiet|','|---|---|---:|---:|---:|---:|']
    for r in cases:lines.append(f"|{r['run']}|{r['archive']}|{r['missed_win_decisions']}|{r['first_ply']}|{r['last_ply']}|{r['last_quiet_count']}|")
    lines+=['','cases.json 附帶最後一次機會的實際選擇、正確走法與各階段模型機率。這是局部病例，不能推出所有和棋本來都能獲勝。']
    (output/'review.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps({'games':len(cases),'missed_opportunities':sum(r['missed_win_decisions'] for r in cases)}))

def rank_existing():
    import numpy as np
    import torch
    from scripts.ai7.runtime import encode, mask_array, load_checkpoint, seed_all
    seed_all(19,2)
    output=ROOT/'benchmark-results/ai7-selfplay/draw-cases/20261114-v1'
    destination=output/'policy-ranking.json'
    if destination.exists():raise FileExistsError(destination)
    cases=json.loads((output/'cases.json').read_text())
    source=ROOT/'benchmark-results/ai7-selfplay/existing-records/20261114-v1/replay-coverage.json'
    opportunities=json.loads(source.read_text())['opportunities']
    rows=[]
    for case in cases:
        st=next(r for r in opportunities if r['run']==case['run'] and r['game']==case['archive'] and r['ply']==case['last_ply'])
        run=ROOT/'benchmark-results/ai7-selfplay/p1p2-comparison/20261114-v1/runs'/case['run']
        for path in [run/'initial.pt',*sorted(run.glob('step-*.pt')),run/'final.pt']:
            model,_=load_checkpoint(path);model.eval()
            with torch.inference_mode():
                d,v=model(torch.from_numpy(encode(st['observation'])).unsqueeze(0),torch.from_numpy(mask_array([st['observation']])))
            pr=d.probs[0].numpy();legal=st['observation']['legal'];targets=st['targets']
            top=max(legal,key=lambda a:pr[a]);best=max(targets,key=lambda a:pr[a])
            rows.append({'run':case['run'],'archive':case['archive'],'ply':st['ply'],'checkpoint':path.name,
                'win_probability':float(pr[targets].sum()),'top_action':top,'top_probability':float(pr[top]),
                'top_is_win':top in targets,'best_win_rank':int(1+sum(pr[a]>pr[best] for a in legal)),
                'predicted_value':float(v.item())})
    destination.write_text(json.dumps(rows,indent=2)+'\n')
    lines=['# 五盤最後勝著機會：策略排名','','固定原始方向；checkpoint 回看，不是當時每次更新的原始模型。', '', '|Run|棋譜|Checkpoint|勝著機率|最佳勝著排名|最高機率是否勝著|','|---|---|---|---:|---:|---|']
    for r in rows:
        lines.append(f"|{r['run']}|{r['archive']}|{r['checkpoint']}|{100*r['win_probability']:.2f}%|{r['best_win_rank']}|{r['top_is_win']}|")
    (output/'policy-ranking.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps({'final_top_is_win':[r['top_is_win'] for r in rows if r['checkpoint']=='final.pt']}))

if __name__=='__main__':
    import sys
    if '--rank-existing' in sys.argv:rank_existing()
    else:main()
