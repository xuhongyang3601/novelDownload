// 全局变量存储小说信息
let novelInfo = {
  title: "",
  currentChapterUrl: "",
  nextChapterUrl: "",
  chapterTitle: "",
  chapterContent: "",
  chapterNumber: 1,
};

let notificationBox = null;

// 创建提示框
function createNotificationBox() {
  if (notificationBox) return;

  notificationBox = document.createElement("div");
  notificationBox.style.position = "fixed";
  notificationBox.style.top = "20px";
  notificationBox.style.right = "20px";
  notificationBox.style.backgroundColor = "#d4edda";
  notificationBox.style.color = "#155724";
  notificationBox.style.padding = "10px 15px";
  notificationBox.style.borderRadius = "5px";
  notificationBox.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
  notificationBox.style.zIndex = "99999";
  notificationBox.style.fontFamily = "sans-serif";
  notificationBox.style.display = "flex";
  notificationBox.style.alignItems = "center";
  notificationBox.style.justifyContent = "space-between";
  notificationBox.style.maxWidth = "450px";

  // 创建关闭按钮
  const closeButton = document.createElement("span");
  closeButton.innerHTML = "×";
  closeButton.style.marginLeft = "10px";
  closeButton.style.cursor = "pointer";
  closeButton.style.fontSize = "18px";
  closeButton.style.lineHeight = "1";
  closeButton.style.userSelect = "none";
  closeButton.style.position = "fixed";
  closeButton.style.top = "30px";
  closeButton.style.right = "30px";
  closeButton.style.zIndex = "999999";
  closeButton.style.color = "#f00";
  closeButton.addEventListener("click", () => {
    notificationBox.remove();
    closeButton.remove();
    notificationBox = null;
  });

  document.body.appendChild(notificationBox);
  document.body.appendChild(closeButton);
}
// 显示提示框
function showNotification(message) {
  createNotificationBox();
  notificationBox.textContent = message;
  notificationBox.style.display = "block";
}
// 检测是否是起点中文网的小说页面
function isQidianNovelPage() {
  return window.location.href.includes("qidian.com");
}

// 获取小说标题
function getNovelTitle() {
  // 起点中文网的小说标题选择器
  const titleElement = document.querySelector("#r-breadcrumbs a:last-child");

  return titleElement ? titleElement.textContent.trim() : "未知小说";
}

// 获取当前章节信息
function getCurrentChapterInfo() {
  // 获取章节标题
  const chapterTitleElement = document.querySelector(".print>h1");
  // 获取章节标题的纯文本，并提取章节数
  let chapterNumber = "";
  let titleText = "";
  if (chapterTitleElement) {
    // 获取h1元素的直接文本内容，不包括子元素
    for (let node of chapterTitleElement.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        titleText += node.textContent.trim();
      }
    }

    // 从标题中提取章节数
    const match = titleText.match(/第(\d+)章/);
    if (match && match[1]) {
      chapterNumber = match[1];
    }
  }

  // 获取章节内容
  const contentElements = document.querySelectorAll(".print>.content>p");
  let contentText = "";
  for (let i = 0; i < contentElements.length; i++) {
    let txt = contentElements[i].querySelector(".content-text").innerText;
    contentText += txt + "\n";
  }
  // 获取下一章链接
  const btns = document.querySelectorAll(".nav-btn-group .nav-btn");

  return {
    title: chapterTitleElement ? titleText : "未知章节",
    chapterNumber: chapterNumber,
    content: contentText ? contentText : "内容获取失败",
    nextUrl: btns.length ? btns[btns.length - 1].href : null,
  };
}
function isPageLoaded() {
  return !!document.querySelector(".print>h1");
}
// 监听来自popup或background的消息
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "downloadNovel") {
    if (!isQidianNovelPage()) {
      sendResponse({
        status: "error",
        message: "当前页面不是起点中文网小说页面",
      });
      return true;
    }
    if (notificationBox) {
      // 删除提示框
      notificationBox.remove();
      notificationBox = null;
    }
    // 获取小说标题
    const novelTitle = getNovelTitle();

    // 获取当前章节信息
    const currentChapter = getCurrentChapterInfo();

    // 发送信息到background.js开始下载
    chrome.runtime.sendMessage(
      {
        action: "startNovelDownload",
        data: {
          novelTitle: novelTitle,
          chapterTitle: currentChapter.title,
          chapterContent: currentChapter.content,
          nextUrl: currentChapter.nextUrl,
          chapterCount: request.chapterCount,
          downloadDir: request.downloadDir,
        },
      },
      function (response) {
        sendResponse(response);
      }
    );

    return true;
  } else if (request.action === "extractChapterContent") {
    // 提取当前页面的章节内容
    if (!isQidianNovelPage()) {
      sendResponse({
        status: "error",
        message: "当前页面不是起点中文网小说页面",
      });
      return true;
    }

    const chapterInfo = getCurrentChapterInfo();
    sendResponse({
      status: "success",
      data: {
        title: chapterInfo.title,
        content: chapterInfo.content,
        nextUrl: chapterInfo.nextUrl,
      },
    });
    return true;
  } else if (request.action === "checkPageLoaded") {
    const loaded = isPageLoaded();
    sendResponse({ status: "success", data: { loaded } });
  } if (request.action === "showDownloadCompleteNotification") {
    const { novelTitle, filePath } = request.data;
    showNotification(`《${novelTitle}》已成功下载到: ${filePath}`);
    sendResponse({ status: "success" });
  }
});
