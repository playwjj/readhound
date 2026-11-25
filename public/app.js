// ReadHound web app (skeleton): loads today's pick and progress.
(function () {
  var status = document.getElementById("today-status");
  var startBtn = document.getElementById("start-btn");

  fetch("/api/today")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.article) {
        status.textContent = data.article.title;
        startBtn.disabled = false;
      } else {
        status.textContent = "今天的故事还在准备中，晚点再来看看。";
      }
    })
    .catch(function () {
      status.textContent = "网络不太顺，检查一下再打开。";
    });

  fetch("/api/progress")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      document.getElementById("stat-streak").textContent = data.streak || 0;
      document.getElementById("stat-articles").textContent = data.articlesDone || 0;
      document.getElementById("stat-chars").textContent = data.charactersMastered || 0;
    })
    .catch(function () { /* stats are best-effort on the home screen */ });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(function () {});
  }
})();
