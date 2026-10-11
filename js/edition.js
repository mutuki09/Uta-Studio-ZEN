/* 版の選択：開いたときに「提出版」と「試作版 v2」のどちらを使うか聞く。
   試作版から戻ってきたとき（?ed=zen）と「次から聞かない」を選んだときは聞かない。 */
(function () {
  "use strict";
  var KEY = "uta-studio-edition-skip";
  var dialog = document.getElementById("editionDialog");
  if (!dialog || typeof dialog.showModal !== "function") return;

  function skipped() {
    if (/[?&]ed=zen\b/.test(location.search)) return true;
    try { return localStorage.getItem(KEY) === "1"; } catch (e) { return false; }
  }
  function remember() {
    if (!document.getElementById("editionRemember").checked) return;
    try { localStorage.setItem(KEY, "1"); } catch (e) { /* 保存できない環境では毎回聞く */ }
  }

  document.getElementById("editionZen").addEventListener("click", function () { remember(); dialog.close(); });
  document.getElementById("editionV2").addEventListener("click", function () { remember(); location.href = "v2/index.html"; });
  // Esc で閉じたときは提出版のまま使う
  dialog.addEventListener("cancel", remember);

  if (!skipped()) dialog.showModal();
})();
