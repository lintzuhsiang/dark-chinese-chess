# E4-D1b · 四種續弈與同盤面比較

150 個新抽樣正式對局，排除 D1 及先前六盤棋譜的 deck。100 和、50 勝負。檢查所有 B 決策、完全揭露且至多四子，共 1831 個根；35 個陽性決策分布於 11 局。原 100 和局中有 5 局找到勝證。母體是歷史 benchmark 的新子樣本。五個半回合、每根動作 256 節點；Unknown 不計作非勝。

每局首個陽性根、每根 8 組共同隨機數。T1/T2 首手一致，T2 沿證書應對引擎實際走法。T0、T1 保留 B 的合法隨機取樣，Greedy 每手取 B 最高機率、並列依原合法順序。對手不變。

| 子集 | 治療 | 勝 / 和 / 敗 | 勝率 | 每百個 B 回合往返 |
|---|---|---|---:|---:|
|all|T0|51 / 37 / 0|57.95%|28.12|
|all|T1|64 / 24 / 0|72.73%|27.20|
|all|T2|88 / 0 / 0|100.00%|0.00|
|all|Greedy|46 / 42 / 0|52.27%|69.25|
|non_immediate|T0|43 / 37 / 0|53.75%|28.28|
|non_immediate|T1|56 / 24 / 0|70.00%|27.42|
|non_immediate|T2|80 / 0 / 0|100.00%|0.00|
|non_immediate|Greedy|38 / 42 / 0|47.50%|69.65|
|original_draw|T0|9 / 31 / 0|22.50%|28.34|
|original_draw|T1|19 / 21 / 0|47.50%|28.94|
|original_draw|T2|40 / 0 / 0|100.00%|0.00|
|original_draw|Greedy|1 / 39 / 0|2.50%|76.45|

T1 對 T0 配對多贏 16、少贏 3，淨 +13/88；T1 未勝的 24 次均是 NO_PROGRESS。T2 的 88 勝是證書控制。Greedy 比 T0 淨少贏 5 次，並出現較多往返。試次只來自 11 個根，不能把 88 當成獨立訓練或獨立局面。

|同盤面集合|架構|Top-1 有勝證|已證勝著機率|
|---|---|---:|---:|
|all|e2b_l|24.57%|30.94%|
|all|e3_joint|41.14%|41.13%|
|all|e3_gate|46.86%|40.34%|
|non_immediate|e2b_l|8.97%|16.95%|
|non_immediate|e3_joint|28.97%|28.97%|
|non_immediate|e3_gate|35.86%|28.05%|
|matched|e2b_l|20.00%|30.23%|
|matched|e3_joint|45.71%|44.35%|
|matched|e3_gate|40.00%|37.09%|

all 是全部 35 個根 × 每個架構 5 個模型；matched 只用根的來源訓練 seed，non_immediate 排除有立即勝著的盤面。相同根、相同 mask、原行棋方。Top-1 未證不一定錯。單根與配對勝負見 analysis.json；逐手 action ID 見 trials.json；證書與搜尋預算見 proofs.jsonl、search.mjs。

重現：在 pinned intel-e3 checkout 以既有 Intel 環境及 PYTHONPATH=.，照 replay.py、search.mjs（node --import ./scripts/ai-eval/register.mjs --input-type=module，stdin）、execute.py、summarize.py 順序執行。依賴原始 checkpoint / S1 驗證包，使用新的結果副本。
