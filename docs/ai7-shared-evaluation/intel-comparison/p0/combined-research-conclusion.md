# Intel AI-7 P0 綜合研究結論

本次是唯讀 follow-up evaluation：未訓練、未微調、未修改任何 checkpoint，也未依結果挑選模型。使用原始 M1 Stage2 400 局面（200 勝著＋200 防守）、45 個預定 checkpoint，及新的 20,000,000–20,000,255 共用牌序。新增對局共 9,216 局，全部完成，沒有 errors、skipped 或 incomplete。獨立訓練重複仍是三個 seeds；這次增加的是測試局面、牌序與外部對手，沒有新增訓練重複。

**主要判斷：GAE-0.95 的實戰優勢成功泛化到這個指定的歷史對手，也有有限的立即勝著／動作排序改善；防守與旋轉一致性並未同步進步。CHAIN-lite 仍沒有一致的對手泛化證據。**

## 1. GAE 是否在獨立立即勝著／防守位置優於 Baseline？

立即勝著有小幅正向證據，防守沒有穩定改善。

| 最終模型，三個 training seeds 的描述性平均 | Baseline | GAE-0.95 | CHAIN-lite |
| --- | ---: | ---: | ---: |
| 立即勝著行動機率 | 10.88% | 13.54% | 10.85% |
| 立即勝著 top-1 正確率 | 10.50% | 14.67% | 11.17% |
| 最佳勝著平均排名（越小越好） | 5.73 | 5.35 | 5.72 |
| 安全防守行動機率 | 57.79% | 57.74% | 58.91% |
| 防守 top-1 正確率 | 57.67% | 56.67% | 59.25% |
| 勝著位置旋轉 TV（越小越一致） | 61.59% | 70.07% | 53.90% |

GAE 勝著機率相對 same-seed Baseline 的差為 +1.60、+3.61、+2.77 個百分點。三個方向一致，但固定模型條件下，position-bootstrap 95% 區間只有後兩個完全高於 0；不能把 200 個位置當成 200 次訓練複驗。防守機率差為 +0.79、−0.46、−0.49 pp，區間全部包含 0。

GAE 在勝著位置的 TV 三個 seeds 都變差，且各自的 paired-position 區間均高於 0。TV 衡量原圖與旋轉圖對應動作分布的差異，不是敗率；較強實戰表現與較差旋轉一致性可以同時出現。CHAIN 的平均 TV 較小，但效果並非三個 seeds 一致，也沒有相應的穩定戰術／棋力提升。

## 2. GAE 是動作排序變好，還是只有採樣分布變化？

**有部分動作排序改善。** 立即勝著 top-1 差為 +3.00、+5.50、+4.00 pp，最佳勝著排名也三個 seeds 都改善。這不只是讓既有排序的機率分布變尖；不過 top-1 和 rank 的條件式區間只有 seed6023 明確排除零，其餘仍有不確定性。

絕對能力仍弱：平均只有 14.67% 的 argmax 動作是立即勝著。不能把兩三個百分點的戰術機率改善，直接當成全部整局勝率增益的原因。這份 bank 是特定的全明子、最多六子的 Random-play 殘局分布，無法代表所有暗棋戰術。

`orientation-label-probabilities.json` 另保存每個 checkpoint／局面／方向的「立即勝著機率」及「安全防守機率」兩種標籤集合，即使該局面屬於另一類；沒有勝著時 winning mass=0、winning rank=null。所有機率都由已保存的 masked-policy arrays 推導，沒有新增模型推論。

## 3. GAE 是否在中途 checkpoint 保留戰術能力？

立即勝著的三-seed 平均機率大致由 10.51% → 11.17% → 11.67% → 12.78% → 13.54%，沒有看到一致的後期勝著能力崩落。每個 seed 的完整五點軌跡都保留在報告，沒有選擇中途最好者取代最終模型。

**防守存在後期回落。** 最明顯的是 seed6037：2.73M→3.64M 的安全防守機率 61.28%→56.88%，差 −4.41 pp，paired-position 95% CI [−7.49,−1.17]；防守 top-1 同期下降 9.75 pp，CI [−15.50,−4.00]。這是具體的局部保留問題，尚不能概括成全面 catastrophic forgetting。

CHAIN seed6023／6037 的勝著機率也在最後階段回落；因此這個 alpha/reference 設計沒有顯示一致的能力保留效果。完整 adjacent 與 initial-to-checkpoint 區間均在 tactical-results.json，所有分析皆探索性、未調整多重比較。

## 4. GAE 是否勝過同一個外部歷史對手？

是，在這個精確固定的 M1 Exp2 Baseline seed4023、3.64M endpoint 下，三個訓練 seeds 都維持優勢。

| 對共同歷史 Baseline；每組 1,536 局 | 勝／和／敗 | 勝率 | 得分率 |
| --- | --- | ---: | ---: |
| Intel Baseline | 148／1162／226 | 9.64% | 47.46% |
| GAE-0.95 | 506／940／90 | 32.94% | 63.54% |
| CHAIN-lite | 176／1142／218 | 11.46% | 48.63% |

GAE 相對 matched-seed Intel Baseline 的得分差分別是 +18.07、+17.77、+12.40 pp；paired-deck bootstrap 95% 區間全部高於 0。對新牌序的 Uniform Random，GAE 勝率 46.68%、得分率 71.61%；Baseline 為 16.67%、54.65%，三個 seed 的差也都為正。

這支持對「新牌序＋此單一歷史對手」的泛化，尚不能擴張成對所有較強對手或 M1 五種 treatment 都較強。實際 M1 當前其他 treatment checkpoints 沒有在此 bundle 中。

CHAIN 對歷史對手的得分差為 +6.45、−0.78、−2.15 pp，未穩定複現。第一個 seed 的進步主要是減少敗場而增加和棋（勝率只 +1.56 pp、和棋率 +9.77 pp），不能把其單一正向 seed 當成穩定的勝局轉換進步。

## 5. 對較有競爭力的歷史對手，GAE 是否仍減少 NO_PROGRESS？

是。NO_PROGRESS 從 Baseline 的 1161/1536＝75.59%，降至 GAE 的 930/1536＝60.55%。同時多 358 勝、少 136 敗、少 222 和；改善同時包含更多勝局與更少敗局，沒有靠更多和棋提高得分。

GAE 仍有 940 局和棋，其中 10 局 CHASE_STALEMATE，整體和棋率仍為 61.20%。平均重複公開盤面次數約 10.28→10.23，沒有大幅下降；走回頭路也受對局長度變短影響。結論是較好的整局結果與較少 NO_PROGRESS，尚不是已解決所有循環、追逐或殘局收束問題。

## 6. Intel／M1 的時間差，哪些可由實際資料確立？

Intel 九個 run 的逐 seed 訓練 wall time、env transitions/s、PPO updates/s、rollout／optimizer／validation 時間，及新舊 evaluation throughput 均已從既有紀錄整理，未再跑訓練。

原始 M1 歷史 checkpoint 提供一個可核對的實際 Baseline 計時：seed4023 跑 3.64M 用 19.07 分鐘，約 3181.9 transitions/wall-s；Intel 三個 Baseline 平均 33.95 分鐘，約 1787.8 transitions/wall-s。這是描述性的單一 M1 run 與三個 Intel runs 比較；M1 為 detailed instrumentation、32 validation pairs，Intel 為 basic、16 pairs，訓練 seeds、依賴版本和執行條件也不同，不能隔離成硬體效應。

Intel 完整 campaign 5.418 小時有實際紀錄；M1 約三小時仍是使用者提供的整輪數字，缺九個 run 的完整對等 logs。不能宣稱 1.81× 是純硬體速度差。精確尚缺路徑與內容見 m1-import-contract.md／missing-m1-timing-inputs.json。

## 7. 下一個受控訓練實驗應研究什麼？

優先用更多全新 training seeds 複驗 GAE-0.95，並在事先固定的新測試牌序與更多 frozen opponents 上確認。這次 final-test 及 tactical bank 已被查看，不能在上面調參後再稱獨立確認。

接著最有依據的單一設計問題是：**GAE 的優勢能否在加入 180-degree symmetry augmentation 後保留，同時改善旋轉偏差與防守保留？** 可用 lambda∈{1,0.95} × symmetry∈{off,on} 的 2×2 設計，保持 terminal rewards、Core、MLP、opponent mixture、步數與評估定義固定；不要同時混入 reward penalty 或 curriculum 來改變多個因素。

也應以共同的 terminal-return calibration targets 驗證 critic，因為 lambda 改變了 value targets，原先 explained variance／MSE 不能直接當成共同真值準確率。這些是下一輪建議，本次未啟動任何新訓練。reserved 100 勝著＋100 防守集繼續保留，直到另行固定確認協議。

## 輸入與比較界線

126 個靜態檔案 checksum 通過；原始歷史 checkpoint 可原生載入，八個 tensors 與 NPZ 完全相同；與 M1 reference 的最大機率差為 2.38e−7，低於 1e−5 門檻。Core source tree、完整 Core/rules tree、public encode()、Policy、mask、action/environment 及 deck generation 均核對相符。Git commit／依賴版本差異如實保留，這是經驗證的 Intel 共同 inference runtime，相同名稱不被當作相同版本的證據。

M1 inventory 顯示舊 14M 區間用於 curriculum 生成，因此原 Intel 14M 結果保留為 Intel 內部證據，不能作為兩機共用的新 final test。新的 20M manifest 已先核對可存取 Intel metadata 與 M1 提供的 inventory，再於任何新結果出現前固定，並保存 exact seeds 及 SHA-256。M1 inventory 是來源機提供的證據，不代表本機獨立取得每份原始 M1 log。

詳細數字、每 seed 的信賴區間與所有中途 checkpoint 見 tactical-generalization-report.md、historical-opponent-report.md、cross-machine-performance.md，以及 combined-research-numeric-appendix.md。原始 game／position results、source snapshot、input SHA、validation 與測試結果均保留。reserved bank 未包含在 bundle，也沒有被讀取或評估。
