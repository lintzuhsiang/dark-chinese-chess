# 第一階段實作與執行結果

此輪只驗證 instrumentation 與觀察早期更新；沒有修改PPO超參數、網路、Core或終局獎勵。

## 驗證結果

- 842個TypeScript測試、29個Python測試通過；lint、格式、型別檢查、build通過。
- 同seed、20ksteps instrumentation開關比較：模型、Adam、RNG、歷史池、遊戲完全一致。
- split/resume的上述狀態與診斷內容完全一致。
- 梯度分項與勝和負分層加總通過；既有.grad與Torch RNG保留；單一合法動作、零變異和局及不存在的回報類別通過。
- 20k時間對照是單次小樣本，完整成本資料在config.json；不是穩健效能基準。

## 短程觀察

| Seed |  Steps | Updates | 採樣minibatches | 共享梯度cosine<0比例 | 固定勝著機率 初→終 | 和局樣本raw advantage>0比例(逐update平均) |
| ---- | -----: | ------: | --------------: | -------------------: | -----------------: | ----------------------------------------: |
| 1011 | 500000 |     117 |              80 |                46.2% |        25.0%→54.2% |                                     49.1% |
| 2027 | 500000 |     121 |              84 |                45.2% |         25.0%→9.1% |                                     46.3% |
| 3037 | 500000 |     119 |              80 |                57.5% |        25.0%→10.8% |                                     44.0% |

上表比例皆為描述性統計。負cosine不等於Critic傷害Actor；和局正advantage不等於鼓勵和棋；兩者需與策略變化和後續受控實驗對照。

每次完整update的Probe KL、機率、raw/normalized advantage與勝和負遊戲／決策占比均已記錄。前10次、之後每10次update採樣各epoch第一個minibatch的梯度；未採樣的update不能當成沒有衝突。所有分層梯度保留完整batch分母和全域advantage正規化。

原始提交邊界紀錄位於metrics.jsonl；update-diagnostics.jsonl與gradient-diagnostics.jsonl是完成後的衍生匯出，resume以原始metrics offset為準。

## 解讀限制

- 每個seed500k、沿用910k快照間隔，因此尚未產生第一個新歷史對手快照。這不是完整長程自我對弈或棋力比較。
- 固定探針仍是少數既有局面；本輪不使用它選擇checkpoint、停止訓練或更新獎勵。
- 原始梯度在Adam與clipping之前；它不是Adam參數變化的精確因果分解。
- 不還原舊checkpoint未保存的梯度；新紀錄只來自這次新的受控訓練。

下一步可以用相同診斷比較較小learning rate，檢驗勝著機率震盪是否變小；本輪尚未執行此調參實驗。

補充60k開關對照通過，跨越前10次詳細採樣邊界，14次更新後模型／Adam／RNG／對手池／遊戲仍完全一致。單次計時off18.42秒、on23.96秒（約+30%）；20k對照也在config.json保留，均非多次平衡順序的正式benchmark。
