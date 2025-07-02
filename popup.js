document.addEventListener("DOMContentLoaded", function () {
  const chapterCountInput = document.getElementById("chapterCount");
  const downloadDirInput = document.getElementById("downloadDir");
  const startDownloadButton = document.getElementById("startDownload");
  const stopDownloadButton = document.getElementById("stopDownload");

  let currentSessionId = null;

  // 从存储中加载上次使用的下载目录
  chrome.storage.local.get(["downloadDir"], function (result) {
    if (result.downloadDir) {
      downloadDirInput.value = result.downloadDir;
    }
  });
  // 监听小说下载完成事件
  chrome.runtime.onMessage.addListener(function (request) {
    if (request.action === "novelDownloaded") {
      // 重置按钮状态
      startDownloadButton.disabled = false;
      stopDownloadButton.style.display = "none";
    }
  });
  // 获取当前活动标签页ID
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const currentTabId = tabs[0]?.id;

    // 主动发送 tabId 给 background.js
    chrome.runtime.sendMessage({
      action: "checkDownloadStatus",
      data: {
        tabId: currentTabId
      }
    }, function (response) {
      if (response && response.isDownloading) {
        currentSessionId = response.sessionId;
        startDownloadButton.disabled = true;
        stopDownloadButton.style.display = "block";
      } else {
        startDownloadButton.disabled = false;
        stopDownloadButton.style.display = "none";
      }
    });
  });

  startDownloadButton.addEventListener("click", async function () {
    const chapterCount = parseInt(chapterCountInput.value);
    if (isNaN(chapterCount) || chapterCount <= 0) {
      alert("请输入有效的章节数");
      return;
    }

    const downloadDir = downloadDirInput.value.trim();
    if (!downloadDir) {
      alert("请输入下载目录名称");
      return;
    }

    // 保存下载目录到存储中，以便下次使用
    chrome.storage.local.set({ "downloadDir": downloadDir });

    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // 发送消息到content script
    chrome.tabs.sendMessage(
      tab.id,
      {
        action: "downloadNovel",
        chapterCount: chapterCount,
        downloadDir: downloadDir
      },
      function (response) {
        if (response && response.status === "started") {
          currentSessionId = response.sessionId;
          startDownloadButton.disabled = true;
          stopDownloadButton.style.display = "block";
        } else if (response && response.status === "error") {
          alert("错误: " + response.message);
        }
      }
    );
  });

  stopDownloadButton.addEventListener("click", function () {
    if (currentSessionId) {
      chrome.runtime.sendMessage(
        {
          action: "stopDownload",
          sessionId: currentSessionId
        },
        function (response) {
          if (response && response.status === "stopped") {
            alert("下载已停止");
            currentSessionId = null;
            startDownloadButton.disabled = false;
            stopDownloadButton.style.display = "none";
          }
        }
      );
    }
  });
});
