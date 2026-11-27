# Fixtures

各家回傳的樣本，給 `test/providers.test.js` 驗證 adapter 的轉換用。欄位跟實際回傳一樣，**不含 email、帳號 ID、組織名**。

端點或欄位改了：把新的回傳去掉帳號資訊後換上，更新 `test/providers.test.js`，並讓 `npm test` 通過。
