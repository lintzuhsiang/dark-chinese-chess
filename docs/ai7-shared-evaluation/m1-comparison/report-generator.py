import json,collections,os
from pathlib import Path
import numpy as np
R=Path('/Users/lintzu-ting/Desktop/dark-chinese-chess/experiment/selfplay-zero');O=R/'benchmark-results/ai7-selfplay/local-analysis/common-20m-2m-v1'
s=json.loads((O/'status.json').read_text());assert s['state']=='completed'
rows=json.loads((O/'summary.json').read_text());ci=json.loads((O/'training-seed-contrasts.json').read_text());pairs=json.loads((O/'paired-deck-comparisons.json').read_text())
tactical=json.loads((O/'tactical/per-seed-summary.json').read_text())
T=['baseline','draw_light','draw_strong','symmetry']
lines=['# M1 本機分析：實際2M模型 × 共同20M decks','','## 範圍與正確性','',
'這次直接評估本機實際完成的四組、seeds5011/5023/5037、各2M的predetermined final，並非3.64M/6011系列。殘局三次未完成、All Draw−0.2未執行，不替代、不補造。這是獨立明示的M1本機2M cohort，Intel原始strict endpoint檢查保持原樣。',
'使用已驗證的Intel原封採樣與統計kernel，固定20,000,000–20,000,255、雙座位、每模型每對手512局，PCG64角色串流、ordered legal actions、temperature1 categorical、CPU2/batch16。Random與固定M1 Exp2 Baseline4023對手分開評估，官方原始效用勝1/和.5/敗0。',
'總計12模型×2對手×512=12,288局，未訓練、未改模型、未用reserved bank。配置及每模型SHA在configuration.json與identities/，每局紀錄在runs/。','']
for opponent in ['random','historical']:
 lines += [f'## 對 {opponent}','','每組1536局。分數和合計WDL僅為描述，獨立學習重複仍為三個seeds。','','|組別|W|D|L|分數|NO_PROGRESS占全部棋局|','|---|---:|---:|---:|---:|---:|']
 base=next(r for r in rows if r['opponent']==opponent and r['treatment']=='baseline')
 for t in T:
  r=next(r for r in rows if r['opponent']==opponent and r['treatment']==t)
  lines.append(f"|{t}|{r['wins']}|{r['draws']}|{r['losses']}|{100*r['score']:.2f}%|{100*r['no_progress_rate']:.2f}%|")
 lines+=['','|方法對Baseline|勝場差|和棋差|敗場差|分數差pp|三seed探索t95 pp|','|---|---:|---:|---:|---:|---|']
 for t in T[1:]:
  r=next(r for r in rows if r['opponent']==opponent and r['treatment']==t);q=next(x for x in ci if x['opponent']==opponent and x['treatment']==t);lo,hi=q['t95']
  lines.append(f"|{t}|{r['wins']-base['wins']:+}|{r['draws']-base['draws']:+}|{r['losses']-base['losses']:+}|{100*q['mean']:+.2f}|[{100*lo:+.2f}, {100*hi:+.2f}]|")
lines+=['','## 每個seed的配對deck分數差','','以下區間是固定模型下的256個deck-pair bootstrap10,000次，不是訓練種子區間。所有探索比較均未做多重校正。', '',
'|對手|方法|Seed|差異pp|deck-bootstrap95 pp|','|---|---|---:|---:|---|']
for r in pairs:
 lo,hi=r['bootstrap95'];lines.append(f"|{r['opponent']}|{r['treatment']}|{r['seed']}|{100*r['difference']:+.2f}|[{100*lo:+.2f}, {100*hi:+.2f}]|")
lines+=['','## 與獨立戰術能力對照','','200個立即勝著＋200個立即防守，各含旋轉版本；每格先平均方向，再平均三個模型。','','|組別|Win mass|Win top1|最佳Win rank|Defense mass|Defense top1|Win TV|Defense TV|','|---|---:|---:|---:|---:|---:|---:|---:|']
for t in T:
 vals=[]
 for cat,key,mult in [('win','target_probability',100),('win','top1_correct',100),('win','best_target_rank',1),('defense','target_probability',100),('defense','top1_correct',100),('win','policy_tv',1),('defense','policy_tv',1)]:
  vals.append(mult*np.mean([r['metrics'][key]['mean'] for r in tactical if r['treatment']==t and r['task']==cat]))
 lines.append('|'+ '|'.join([t,*[f'{v:.3f}' for v in vals]])+'|')
lines+=['','## 判讀原則與限制','',
'- 和棋下降必須拆成多贏與多輸；原始分數為主要效用，不比較各組不同的訓練reward。',
'- 固定模型deck bootstrap和三seed訓練變異分開呈現；n=3的t區間相當脆弱，且以這批固定decks為條件、沒有包含換一批decks的變異；不能據點估計宣告優勝。區間包含零也不是等效性證明。',
'- 共同協定的新decks是獨立評估，不能把它和先前16M/17M測試池併在一起增加顯著性。',
'- Intel GAE的同機、同預算對照結果不能直接與這組M1 2M數字作演算法因果排名；預算、種子與實作路線不同。',
'- 立即勝著機率仍接近10.52%隨機基準；TV只衡量方向一致性，不代表棋力。',
'- 殘局課程的邊界錯誤與未完成狀態尚未修復，本次沒有重訓。', '',
'本機結果不另外建立Intel交付包。完整原始每局資料、配置、模型指紋與比較結果保存在本目錄。']
(O/'research-review.md').write_text('\n'.join(lines)+'\n')
# A static comparison plot; no pooling games as training seeds.
os.environ['MPLCONFIGDIR']='/tmp/ai7-local-analysis-mpl'
import matplotlib;matplotlib.use('Agg')
import matplotlib.pyplot as plt
fig,axs=plt.subplots(1,2,figsize=(11,4.5))
for ax,op in zip(axs,['random','historical']):
 for i,t in enumerate(T):
  r=next(r for r in rows if r['opponent']==op and r['treatment']==t)
  ax.bar(i,r['wins']/r['games']*100,color='#2b8c74',label='Win' if i==0 else None)
  ax.bar(i,r['draws']/r['games']*100,bottom=r['wins']/r['games']*100,color='#c9d2dd',label='Draw' if i==0 else None)
  ax.bar(i,r['losses']/r['games']*100,bottom=(r['wins']+r['draws'])/r['games']*100,color='#cc6b5a',label='Loss' if i==0 else None)
  ax.text(i,102,f"score {100*r['score']:.1f}",ha='center',fontsize=8)
 ax.set_xticks(range(4),['Base','Draw -.05','Draw -.2','Rotation']);ax.set_ylim(0,111);ax.set_ylabel('Game outcomes (%)');ax.set_title('vs '+op);ax.legend(loc='upper right',fontsize=8)
fig.suptitle('M1 actual 2M cohort: descriptive W/D/L on shared 20M decks');fig.tight_layout();fig.savefig(O/'wdl-comparison.png',dpi=160);plt.close(fig)
print(O/'research-review.md')
