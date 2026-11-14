# AI-7：可復盤紀錄與 NO_PROGRESS 問題

此變更位於 `experiment/selfplay-zero`。GameCore、回饋、既有 AI 與 Branch A
不變。沒有啟動正式學習實驗；驗證只使用有界的短程 PPO 正確性測試。

## 完整紀錄模式

新增 `--audit-records full --instrumentation detailed`，預設仍為 off。

每次完整提交的 update 在原有 metrics.jsonl 內保存：

- games：完成的 learner-seat 對局，包含 seed、seat、opponent、archive、結果。
  與 decisions.game_index 對齊；原始盤面不進入策略特徵。
- decisions：每個 learner 決策的 row、game_index、decision、原始 ply、quiet、
  暗子數、合法動作 IDs 及其 rollout-time 機率分布、動作、rollout-time log probability 與 value、當步 reward、
  終局 outcome、return target、raw advantage、全 batch normalized advantage。
- gradients：每個實際 optimizer minibatch 的 epoch、minibatch、row_indices、
  當時選擇動作的 log probability、value、importance ratio、逐列 policy loss；
  Actor、加權 Critic、加權 Entropy 與合併梯度 norm、共享層 cosine、
  win/draw/loss Actor 梯度摘要、clip 前後 norm。
- 同一 minibatch 實際 Adam 參數位移 L2，以及固定 Probe 的前後 KL／群組機率。
  可以把能力變化對齊到同一次更新的梯度與資料組成。

梯度保存的是摘要，不是每個參數的完整向量，也不是逐決策的完整參數梯度。
Adam 位移是合併更新的實測，不能由各 loss 的梯度 cosine 宣告因果分解。
Probe 不進 loss、不選 checkpoint、不決定停止。原本 detailed 模式的採樣方式
維持不變；只有 full audit 才記錄全部 minibatches。

資料與既有 metrics_offset 一起納入 checkpoint 邊界。中斷的更新不發布
診斷，模型／Adam／RNG 回滾；resume 將越過邊界的紀錄保留為 orphan。

## 更多棋譜與容量限制

Full audit 預設 `max_replays=512`（原模式仍 8），最多可明確設定 2,048。
每盤依 `deck seed % replay_sample_denominator == 0` 決定保存，預設分母 32。
在約 14,000 局中期望約 438 盤，比原先四盤多，且不固定只抽 batch game-0。
這是可重現的 seed 篩選，不依勝負或戰術挑選；達 cap 後仍記錄摘要與決策資料，
但不再增加完整棋譜。必須揭露實際保存比例與是否碰到 cap。

`--audit-max-bytes` 預設 250,000,000，計算已提交的 diagnostics JSON payload。
若下一個 update 超出此預算，回滾該 update 並以 `audit_budget` 正常停止，
不默默關閉觀察；已寫出的未提交 replay 只可作 orphan，不計入提交棋譜。
checkpoint、replay、其他 log 的總量仍受原有 artifact root 5GB guard 約束。
預算參數在 exact resume 時不能改動。

Full audit 適合先做短程受控驗證。加入 legal 機率分布後的 12k-step 測試，
約 4.67MB diagnostics；單次 off/on 約 3.69/7.96 秒，約 2.16 倍，
包含增加棋譜與完整梯度觀察的成本。這不是平衡順序、多次重複的 benchmark。
若按此密度跑 3.64M，診斷可能約 1.42GB，預設 250MB 會先停止。
正式 campaign 前須測量、選定預算／觀察範圍，不能直接沿用九組 full audit。
完整模式成本偏高，應先用短程定位；長程採何種觀察強度需另外固定並揭露，
不能默默把完整紀錄降為採樣。

啟動範例（不是已啟動的正式實驗）：

```sh
mkdir -p benchmark-results/ai7-selfplay/audit-pilot
AI7_ARTIFACT_ROOT="$PWD/benchmark-results/ai7-selfplay/audit-pilot" \
.venv/bin/python -m scripts.ai7.train \
  --output benchmark-results/ai7-selfplay/audit-pilot/seed-5011 \
  --seed 5011 --max-env-steps 50000 --training-seconds 600 \
  --instrumentation detailed --audit-records full \
  --max-replays 512 --replay-sample-denominator 32 --audit-max-bytes 250000000
```

## 先處理哪一種和棋

全部第二輪摘要中，NO_PROGRESS 占和棋約 99.87%。但不能把所有和棋都視為
模型消極：可能是合理和局、雙方錯過機會、或缺乏長期轉換能力。

本次已從舊 36 盤棋譜整理出五盤「錯過立即勝著後和棋」，共 35 次錯過。
復盤清單與每盤最後一次機會的五階段模型機率在：
`benchmark-results/ai7-selfplay/draw-cases/20261114-v1/review.md` 與 `cases.json`。
兩盤最後機會 quiet=59；另外三盤為 56、57、19。這些是局部病例，不能推論
整體和棋都能靠一手戰術解決。

下一輪先檢驗「有勝著但沒有轉換」，不是先懲罰和棋：

1. 對已保存的五盤逐一對照最後勝著機會、實際走法與 checkpoint 策略。
   分辨模型給勝著低機率、只是抽樣沒選中，或偏好其他動作。
2. 短程 full audit 中，把已抽到的完整棋譜重播後的戰術標籤，依 game/ply
   join 到當時 value、advantage、minibatch 與 Probe 變化。
   所有標籤仍只供離線診斷，不進訓練。未保存完整棋譜的局面不能補造標籤。
3. 同時比較 draw 決策在 quiet 早／晚期的 raw／normalized advantage、
   Actor 梯度組成與棋局結果，檢查是否有可重現的更新機制。
4. 根據證據才決定是否測試探索／對手排程、CHAIN 或 Actor/Critic 分離。
   高 Random 與固定低 LR 沒有顯示優於 Baseline，不直接採用為解法。

不增加 capture reward、FLIP bonus、repetition penalty、draw penalty，
不縮短 Core 的 NO_PROGRESS 門檻。少和棋必須分解為增加勝場還是增加敗場；
若只是冒險輸更多，不能算成功。

## 驗證

`test_audit.py` 檢查開關模式模型／Adam／RNG／對手池一致、split/resume
診斷完全一致、每個 optimizer step 的 decision index 與 Probe 對齊、
terminal-return advantage 正確、更多完整棋譜存在，以及容量停止回滾到
零更新的有效 checkpoint。測試有固定 step cap，不以牆鐘時間比較模型。

## 五個和棋病例的最後機會排名

已用各 run 五個 checkpoint 對同一個最後機會局面回看。最終模型在五個病例中，
四個把最佳勝著排在第 7、7、10、14 名，只有一個排第一。這些局面中單純改成
argmax 也無法保證抓住勝著，問題不只是抽樣沒有選中最高機率動作。
這是事後五例，不能外推到全部和棋或當時未保存的策略。

其中 low_lr seed4011 的一例，1.82M 時最佳勝著排名第一、機率 29.14%，
最終變成第七、5.94%。支持把「有用偏好如何流失」列為受控診斷問題，
不是藉此直接證明 Critic 傷害或需要和棋懲罰。
詳見 draw-cases 目錄的 policy-ranking.md/json。
