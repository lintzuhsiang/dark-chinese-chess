# AI-7 E5 人機對戰模型交接

來源是 E5 兩批選出的 4 個 3.64M final，皆為 seed 1994037。E5 全部 33 個 endpoints 用同一組 256 decks、雙座位，對 92001 和 S1 Guard 各 512 局。以下每列共 1,024 局。此處是依已觀察結果選出的代表 checkpoint。戰術指標為已曝光 E4 開發資料的 source-game 等權遠炮安全排序。

| 選單 ID | 角色 | 勝／和／負 | Score | 遠炮排序 |
|---|---|---:|---:|---:|
| e5-a-low-loss | A，3×3，33 個 endpoints 中敗場最少且 Score 最高 | 465／477／82 | 68.70% | 47.55% |
| e5-j-most-wins | J，Axis-aware + Flatten，勝場最多 | 497／372／155 | 66.70% | 52.10% |
| e5-f-far-tactics | F，Axis-aware + S2，開發遠炮排序最高 | 442／491／91 | 67.14% | 75.67% |
| e5-e-wide-cnn | E，4×8 CNN，新純 PPO 最佳組別的最高 Score checkpoint | 479／417／128 | 67.14% | 43.86% |

## 整合契約

- 選單以 manifest.json 的 ID 和 label 為準。使用 portable_file 的純推論 JSON 權重。原始 PyTorch checkpoint SHA 和匯出 SHA 分別記錄。權重包含已訓練 actor/critic，不含 optimizer 或私有狀態。
- GameCore public-v1，2163 維輸入、1056 種 action ID。編碼來源是 pinned base 的 scripts/ai7/runtime.py 的 encode、mask_array，以及 scripts/ai7/cnn.py 的 split_public_features。先比對 fixed-vectors.json 的 public observation → board/side → policy。Board 為 [49,8,4]，side 為 595 維。
- Action ID 0–31 為 FLIP，MOVE 為 32 + source×32 + target。行列座標順序、合法動作清單由 GameCore 提供。參考實作只回傳所傳 legal_action_ids 順序上的機率，使用者介面出招前仍走 GameCore 合法判定。
- A 為 3×3 Mean。E 擴大第二層為高 8×寬 4，明確 padding 左 1、右 2、上 3、下 4。F/J 的 Axis branches 依 3×3、1×7、15×1 順序 concat，1×1 fusion 後 Tanh。F 使用 Mean，J 使用 row-major 棋格順序，每格依 channel 排列後 flatten。
- 正常對局預設採合法 masked categorical、temperature 1。S2 在訓練時生效，F 的人機推論不需戰術標籤庫或 Guard。
- reference-inference.mjs 是可在瀏覽器執行的 JS 數值參考，呼叫 inferSpatial(weights, board, side, geometry, legal, slots)，回傳 legal 順序的 prob 和 scalar value。正式 UI 可接在 Web Worker。先比對所有 fixture 的 legal indices、機率和值，abs tolerance 1e−5。公共 encoder 仍需在選單實作分支接上並驗證。
- 在此目錄執行 node verify.mjs 可驗 portable SHA 和全部固定向量。驗收範圍是已編碼張量進入 JS forward 的結果。

## 給人機對戰分支的任務

接入上述四個模型選項。共用既有對局與 GameCore 流程，新增模型選單與按需載入。對每個選項驗證 model ID、固定向量、P1/P2、FLIP／MOVE、同局中選項與權重對應，並完成一次瀏覽器人機對局 smoke test。
