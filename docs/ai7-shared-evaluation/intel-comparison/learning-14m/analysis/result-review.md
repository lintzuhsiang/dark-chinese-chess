# Intel AI-7 實驗結果分析

GAE-0.95 在這輪有一致而明顯的實戰優勢：三個 training seeds 都增加對 Random 的勝場、減少敗場，且直接對 Baseline 也佔優。CHAIN-lite 只有較小的正向訊號，尚不足以認定棋力穩定提升。固定戰術 probe 不支持『GAE 已全面改善戰術』的結論。

實驗於台北時間 2026-11-15T02:08:03.950910+08:00 開始、2026-11-15T07:33:06.970132+08:00 結束，約 5.42 小時。九個 run 均達 3,640,000 transitions，總計 32,760,000，沒有縮短訓練。

## 資料核對

配置 hash 與啟動紀錄相符；凍結 source 無變更；45 個 checkpoint 的 SHA-256 全部吻合；同 seed 三組初始對局一致。正式評估共 6,144 局：18 組初始／最終對 Random，加上 6 組直接對戰；全部完成，skipped、incomplete、errors 均為 0。訓練中 milestone 截斷的局另有計數，沒有當成和棋。

## 最終對 Random

每組合計 768 局＝3 個獨立 training seeds × 128 張牌序 × 雙座位。以下總表只作描述；學習方法的重複實驗數仍是 3。

| 方法 | 勝／和／敗 | 勝率 | 和棋率 | 敗率 | 得分率 |
| --- | --- | ---: | ---: | ---: | ---: |
| Baseline | 140/572/56 | 18.23% | 74.48% | 7.29% | 55.47% |
| GAE-0.95 | 347/399/22 | 45.18% | 51.95% | 2.86% | 71.16% |
| CHAIN-lite | 170/536/62 | 22.14% | 69.79% | 8.07% | 57.03% |

初始控制三組相同：129 勝／542 和／97 敗，勝率 16.80%、得分率 52.08%。Baseline 訓練後僅多 11 勝，少 41 敗、多 30 和，改善主要表現在少輸。GAE 則相對最終 Baseline 多 207 勝、少 173 和、少 34 敗，勝率增加 26.95 個百分點：分數提升並非靠增加和棋。CHAIN-lite 相對 Baseline 多 30 勝、少 36 和，但也多 6 敗。

GAE 的三個 seed 相對 Baseline 勝率分別提高 25.39、33.20、22.27 個百分點；得分差的 paired bootstrap 95% 區間分別為 [9.57,19.53]、[15.23,24.22]、[8.40,17.38] 個百分點，全部為正。三 seed 勝率差平均為 +26.95 pp，探索性 seed-level t95 為 [12.96,40.95] pp；n=3、近似常態及未調整多重比較限制仍成立。

CHAIN-lite 勝率分別提高 3.52、2.73、5.47 pp；但各 seed 的得分差 paired bootstrap 區間全部包含 0。原報告對其三個勝率差計算的 t95 雖略高於 0，這只描述三個訓練重複在固定測試集上的差異；不能忽略每個模型的牌序不確定性、n=3 與多重比較而直接宣布有效。

雙座位也支持 GAE 的實戰優勢：先手勝率 172/384＝44.79%，後手 175/384＝45.57%；Baseline 分別為 15.89%、20.57%。因此優勢不是只由單一座位帶動。

## 直接對 Baseline

以下每個 treatment 使用相同 training seed 的最終 Baseline 作對手；與外部凍結對手評估分開。

| 方法 | 勝／和／敗 | 實際勝率 | 得分率 |
| --- | --- | ---: | ---: |
| GAE-0.95 | 266/460/42 | 34.64% | 64.58% |
| CHAIN-lite | 114/565/89 | 14.84% | 51.63% |

GAE 三個 seed 的得分率為 59.96%、65.63%、68.16%；固定模型條件下的 paired bootstrap 95% 分別為 [56.64,63.28]、[62.50,68.75]、[64.84,71.48]%。較保守的 Hoeffding 區間在第一個 seed 仍涵蓋 50%，其餘兩個高於 50%；不要將不同區間方法混稱為同一確定程度。

CHAIN-lite 三個 seed 的得分率僅 51.37%、51.95%、51.56%；paired bootstrap 區間均涵蓋 50%。這輪直接對戰對其棋力提升的支持有限。

## 和棋、勝局轉換與重複行為

在相同牌序與座位配對中，Baseline 和棋而 GAE 勝出的有 256 局，Baseline 和棋而 GAE 輸掉有 12 局；也有 Baseline 贏而 GAE 和的 66 局、Baseline 贏而 GAE 輸的 8 局。這是不同策略路徑的配對結果，不是把同一個盤面繼續走的因果實驗，但顯示改善幅度不是少量偶然勝局。

Baseline 的 NO_PROGRESS 為 572/768；GAE 為 397/768，另有 2 局 CHASE_STALEMATE；CHAIN-lite 為 535/768，另 1 局 CHASE_STALEMATE。GAE 仍約一半對局和棋，問題沒有消失。

GAE 對 Random 的平均長度由 Baseline 的 252.3 降至 219.0 plies；但重複公開盤面次數由 5.99 升至 6.65。每局自身走回頭路次數略降（31.61→29.02），也受到對局變短影響。不能把這次成功簡化為『已治好循環／追逐』，或將 NO_PROGRESS 直接當作重複盤面規則。

## 戰術證據仍有限

八個固定 probes 中，立即勝著類與避免立即敗類各僅 3 個適用局面。立即勝著行動的平均最終機率：Baseline 58.07%、GAE 38.92%、CHAIN-lite 25.11%，隨機基準約 25%；這不是對局勝率。GAE 的三個 seed 分別為 15.51%、23.60%、77.66%，差異很大，其中一個 seed 在唯一的 winning-repetition-break probe 上，正確動作機率只有 1.23%。

因此目前能支持的是『對 Random 與 matched Baseline 的整局勝負更好』，不能擴大成全面戰術變強。M1 的獨立 400 局面戰術集尚未轉移，reserved 100 勝著＋100 防守集保持未讀、未評估。

## 學習曲線與機制

最後 100 次 rollout 的平均 value explained variance：Baseline 約 −0.19、GAE 約 +0.56、CHAIN-lite 約 −0.16。GAE 的 value MSE 也較低，但 lambda 改變了 value return targets；這些指標不是對共同終局真值的等條件比較，不能直接證明 critic 準確度改善了這麼多。需要獨立的共同 terminal-return calibration 才能驗證該機制。

合理假說是 lambda=0.95 改變長局稀疏回饋的 bias／variance 取捨，讓 advantage 與 value 更新更可用；gamma 仍是 1，沒有改終局獎勵。這是與觀察相容的解釋，尚未完成因果隔離。GAE 的 normalized entropy 下降也只表示策略更集中，不能單獨當棋力指標。

CHAIN-lite 確實施加 KL 正則項，末段平均 reference KL 約 0.0068、alpha×KL 約 0.00068；PPO 近似 KL 略低。Baseline 沒有同一組 reference-state KL 測量，不能把不同指標直接相減來宣稱 churn 已受控。此結果僅適用於 alpha=0.1、256 個當前 rollout references 的簡化版本，不能否定完整 CHAIN 方法。

這台 Intel 上每 run 平均訓練時間約 Baseline 33.9 分鐘、GAE 34.1 分鐘、CHAIN-lite 37.4 分鐘。CHAIN-lite 多約 10% wall time；optimization 階段約多 61%。這是本機觀察值，包含實際 rollout 差異，不代表跨硬體固定速度比。GAE 的完整 PPO update 次數較多，但 optimizer minibatch steps 三組都約 30,100；沒有藉由額外環境 transitions 或明顯多出的 optimizer steps 取得優勢。

## 決策與尚未完成的驗證

優先保留 GAE-0.95 作為下一輪複驗候選，但不改現有產品預設 AI。下一輪應使用更多全新 training seeds 與事先固定的新確認牌序，補共同歷史 Baseline 對手、M1 已有非保留戰術集；不可在這份 final-test 上調參後仍稱為獨立確認。CHAIN-lite 目前不值得直接取代 Baseline，也不能據此說所有 KL／CHAIN 正則化無效。

跨 M1 的訓練 source fingerprints、牌序排他性、共同 historical checkpoint 與 dependency compatibility 仍 pending。Intel 使用 PyTorch 2.2.2／NumPy 1.26.4，與 M1 requirement pins 不同。這次結果可作 Intel 內部的 controlled comparison，尚不能判定勝過 M1 五種 treatment。

原始來源：../comparison.json、../evaluations/、../head-to-head/、../probes/、../runs/*/metrics.jsonl。result-review.json 保存衍生數據與輸入檔案 hashes；outcome-summary.png 為結果圖。本分析未執行任何新訓練、模型推論或模型選擇。
