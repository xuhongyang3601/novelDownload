// 存储下载会话信息，使用Map来跟踪不同的下载任务
const downloadSessions = new Map();

// 生成唯一的会话ID
function generateSessionId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

// 保存章节内容为TXT文件
function saveChapterToFile(
  sessionId,
  novelTitle,
  chapterNumber,
  content,
  downloadDir
) {
  // 构建文件路径，包含下载目录
  const filename = `${downloadDir}/${novelTitle}-${chapterNumber}.txt`;

  // 创建Blob对象
  const blob = new Blob([content], { type: "text/plain" });

  const reader = new FileReader();
  reader.onload = function () {
    chrome.downloads.download({
      url: reader.result,
      filename: filename,
      saveAs: false,
    });

    // 标记该会话已选择保存路径
    if (chapterNumber === 1) {
      const session = downloadSessions.get(sessionId) || {};
      session.savePathSelected = true;
      downloadSessions.set(sessionId, session);
    }
  };
  reader.readAsDataURL(blob);
}

// 格式化章节内容
function formatChapterContent(chapterNumber, title, content) {
  return `${title}\n\n${content}\n\n`;
}
async function checkPageLoaded(tabId, timeout = 60000, interval = 500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, {
        action: "checkPageLoaded",
      });
      if (response?.data?.loaded) {
        return true;
      }
    } catch (e) {
      console.warn("页面通信失败，重试中...");
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}
// 继续下载后续章节
async function continueDownloadChapters(sessionId, remainingChapters, originalTabId) {
  if (remainingChapters <= 0) {
    // 下载完成，清理会话
    downloadSessions.delete(sessionId);
    return;
  }

  try {
    // 获取会话信息
    const session = downloadSessions.get(sessionId);
    if (!session) {
      console.error("找不到下载会话:", sessionId);
      return;
    }

    // 检查下载是否被停止
    if (!session.isActive) {
      console.log("下载已被用户停止:", sessionId);
      return;
    }

    // 创建一个新标签页来加载下一章
    const tab = await chrome.tabs.create({
      url: session.nextUrl,
      active: false,
    });

    // 更新会话中的标签页ID
    session.tabId = tab.id;
    downloadSessions.set(sessionId, session);

    // 等待页面加载完成
    const pageLoaded = await checkPageLoaded(tab.id);
    if (!pageLoaded) {
      console.error("页面加载超时");
      await chrome.tabs.remove(tab.id);
      return;
    }

    // 再次检查下载是否被停止
    if (!downloadSessions.get(sessionId)?.isActive) {
      console.log("下载在页面加载过程中被停止:", sessionId);
      await chrome.tabs.remove(tab.id);
      return;
    }

    // 执行content script提取章节内容
    let result = null;
    for (let i = 0; i < 30; i++) {
      try {
        result = await chrome.tabs.sendMessage(tab.id, {
          action: "extractChapterContent",
        });
        if (result && result.status === "success") break;
      } catch (e) {
        console.warn(`第${i + 1}次提取内容失败，重试中...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (result && result.status === "success") {
      // 再次检查下载是否被停止
      if (!downloadSessions.get(sessionId)?.isActive) {
        console.log("下载在内容提取过程中被停止:", sessionId);
        await chrome.tabs.remove(tab.id);
        return;
      }

      // 更新会话中的下一章URL
      session.nextUrl = result.data.nextUrl;
      downloadSessions.set(sessionId, session);

      // 当前章节编号
      const currentChapterNum =
        session.startChapterNum + session.downloadedCount;

      // 格式化章节内容
      const chapterContent = formatChapterContent(
        currentChapterNum,
        result.data.title,
        result.data.content
      );

      // 保存章节内容
      saveChapterToFile(
        sessionId,
        session.novelTitle,
        currentChapterNum,
        chapterContent,
        session.downloadDir
      );

      // 更新已下载章节计数
      session.downloadedCount++;
      downloadSessions.set(sessionId, session);

      // 继续下载下一章
      if (remainingChapters > 1 && result.data.nextUrl) {
        // 关闭当前标签页
        await chrome.tabs.remove(tab.id);

        // 继续下载下一章
        await continueDownloadChapters(sessionId, remainingChapters - 1, originalTabId);
      } else {
        if (originalTabId) {
          chrome.tabs.sendMessage(originalTabId, {
            action: "showDownloadCompleteNotification",
            data: {
              novelTitle: session.novelTitle,
              filePath: `${session.downloadDir}/${session.novelTitle}`,
            },
          });
          chrome.runtime.sendMessage({
            action: "novelDownloaded",
            data: {
              novelTitle: session.novelTitle,
              filePath: `${session.downloadDir}/${session.novelTitle}`,
            },
          });
        } else {
          console.warn("无法找到原始页面 tabId");
        }
        // 下载完成，关闭标签页
        await chrome.tabs.remove(tab.id);


        // 清理会话
        downloadSessions.delete(sessionId);
      }
    } else {
      // 提取失败，关闭标签页
      // await chrome.tabs.remove(tab.id);
      console.error("提取章节内容失败", result);
      // 清理会话
      downloadSessions.delete(sessionId);
    }
  } catch (error) {
    console.error("下载章节时出错:", error);
    // 出错时也要清理会话
    downloadSessions.delete(sessionId);
  }
}


chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "startNovelDownload") {
    // 创建新的下载会话
    const sessionId = generateSessionId();
    const {
      novelTitle,
      chapterTitle,
      chapterContent,
      nextUrl,
      chapterCount,
      downloadDir,
    } = request.data;

    // 创建新的下载会话时记录 tabId
    downloadSessions.set(sessionId, {
      originalTabId: sender.tab ? sender.tab.id : null,
      tabId: sender.tab ? sender.tab.id : null, // 记录发起请求的 tabId
      novelTitle: novelTitle,
      downloadDir: downloadDir,
      savePathSelected: false,
      startTime: Date.now(),
      nextUrl: nextUrl,
      startChapterNum: 1,
      downloadedCount: 0,
      isActive: true,
    });

    // 保存第一章
    const firstChapterContent = formatChapterContent(
      1,
      chapterTitle,
      chapterContent
    );
    saveChapterToFile(
      sessionId,
      novelTitle,
      1,
      firstChapterContent,
      downloadDir
    );

    // 更新已下载章节计数
    const session = downloadSessions.get(sessionId);
    session.downloadedCount++;
    downloadSessions.set(sessionId, session);

    // 如果需要下载多章，继续下载后续章节
    if (chapterCount > 1 && nextUrl) {
      continueDownloadChapters(sessionId, chapterCount - 1, sender.tab.id);
    }

    sendResponse({ status: "started", sessionId: sessionId });
  } else if (request.action === "stopDownload") {
    // 处理停止下载请求
    const { sessionId } = request;
    if (downloadSessions.has(sessionId)) {
      const session = downloadSessions.get(sessionId);

      // 标记会话为非活跃
      session.isActive = false;
      downloadSessions.set(sessionId, session);

      // 如果有打开的标签页，关闭它
      if (session.tabId) {
        try {
          chrome.tabs.remove(session.tabId);
        } catch (error) {
          console.error("关闭标签页失败:", error);
        }
      }

      // 发送响应
      sendResponse({ status: "stopped" });

      // 延迟清理会话
      setTimeout(() => {
        if (downloadSessions.has(sessionId)) {
          downloadSessions.delete(sessionId);
        }
      }, 1000);
    } else {
      sendResponse({ status: "error", message: "找不到指定的下载会话" });
    }
  } else if (request.action === "checkDownloadStatus") {
    const currentTabId = request.data?.tabId || sender.tab?.id || null;
    let isDownloading = false;
    let activeSessionId = null;

    for (const [sessionId, session] of downloadSessions.entries()) {
      if (session.isActive && session.originalTabId === currentTabId) {
        isDownloading = true;
        activeSessionId = sessionId;
        break;
      }
    }

    sendResponse({
      isDownloading: isDownloading,
      sessionId: activeSessionId
    });
  }
  return true;
});

console.log("background.js loaded");
