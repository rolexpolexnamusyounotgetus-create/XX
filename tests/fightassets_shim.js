/* Dev shim: fill window.FightAssets with URLs of assets/embed/* when a dev page is served over http
   (python3 -m http.server lists the directory). The built page carries data: URIs instead. */
(function () {
  var base = (document.currentScript && document.currentScript.getAttribute("data-base")) || "../assets/embed/";
  var A = window.FightAssets = window.FightAssets || {};
  try {
    var x = new XMLHttpRequest();
    x.open("GET", base, false); x.send();
    var re = /href="([^"?\/]+)"/g, m;
    while ((m = re.exec(x.responseText))) { var n = decodeURIComponent(m[1]); if (n.charAt(0) !== "." && !A[n]) A[n] = base + m[1]; }
  } catch (e) { console.warn("fightassets shim:", e); }
})();
