chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractTranscript") {
    console.log("Content script received extractTranscript message.");

    async function ensureTranscriptVisibleAndExtract() {
      try {
        let transcriptSegments = document.querySelectorAll('ytd-transcript-segment-renderer');
        if (transcriptSegments.length > 0 && isElementVisible(transcriptSegments[0])) {
          console.log("Transcript panel already open.");
          return extractData(transcriptSegments);
        }

        const showTranscriptButton = document.querySelector(
          'ytd-video-description-transcript-section-renderer button[aria-label="Show transcript"], ytd-video-description-transcript-section-renderer button[aria-label^="Show transcript for"]'
        );

        if (showTranscriptButton) {
          console.log("Found 'Show transcript' button in description, clicking it.");
          showTranscriptButton.click();
        } else {
           console.log("Show transcript button in description not found. Trying menu button.");
           const moreActionsButton = document.querySelector('#actions ytd-menu-renderer #button, #actions-inner ytd-menu-renderer #button');
           if (moreActionsButton) {
               moreActionsButton.click();
               await new Promise(resolve => setTimeout(resolve, 500));

               const menuItems = document.querySelectorAll('tp-yt-paper-listbox ytd-menu-service-item-renderer, ytd-menu-popup-renderer ytd-menu-service-item-renderer');
               let showTranscriptMenuItem = null;
               menuItems.forEach(item => {
                   const textElement = item.querySelector('yt-formatted-string');
                   if (textElement && (textElement.textContent.trim() === "Show transcript" || textElement.textContent.trim() === "Open transcript")) {
                       showTranscriptMenuItem = item;
                   }
               });

               if (showTranscriptMenuItem) {
                   console.log("Found 'Show transcript' in menu, clicking it.");
                   showTranscriptMenuItem.click();
               } else {
                   console.log("'Show transcript' menu item not found.");
                   const transcriptPanel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
                   if (transcriptPanel && transcriptPanel.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') {
                       console.log("Transcript panel seems to be open.");
                   } else {
                       return { error: "Could not find a way to open the transcript. Please open it manually and try again." };
                   }
               }
           } else {
               console.log("More actions button not found.");
               const transcriptPanel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]');
               if (transcriptPanel && transcriptPanel.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') {
                   console.log("Transcript panel seems to be open.");
               } else {
                  return { error: "Could not find a way to open the transcript. Please open it manually and try again." };
               }
           }
        }

        for (let i = 0; i < 20; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          transcriptSegments = document.querySelectorAll('ytd-transcript-segment-renderer');
          if (transcriptSegments.length > 0 && isElementVisible(transcriptSegments[0])) {
            console.log("Transcript segments loaded after clicking.");
            return extractData(transcriptSegments);
          }
        }
        return { error: "Transcript did not load after attempting to open it. Please open it manually." };

      } catch (e) {
        console.error("Error in ensureTranscriptVisibleAndExtract:", e);
        return { error: `Error: ${e.message}` };
      }
    }

    function isElementVisible(el) {
        if (!el) return false;
        return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    function extractData(segments) {
      const transcriptData = [];
      segments.forEach(segment => {
        const timestampEl = segment.querySelector('.segment-timestamp');
        const textEl = segment.querySelector('.segment-text, .segment-text-container yt-formatted-string, .segment-text-container span');

        if (timestampEl && textEl) {
          transcriptData.push({
            timestamp: timestampEl.textContent.trim(),
            text: textEl.textContent.trim()
          });
        }
      });
      console.log("Extracted data:", transcriptData);
      return { transcript: transcriptData };
    }

    ensureTranscriptVisibleAndExtract()
      .then(result => sendResponse(result))
      .catch(error => {
          console.error("Error during transcript extraction process:", error);
          sendResponse({ error: `Unhandled error: ${error.message}` });
      });

    return true;
  } else if (request.action === "seekTo") {
    const videoElement = document.querySelector('video.html5-main-video');
    if (videoElement) {
      videoElement.currentTime = request.time;
      console.log(`Seek to ${request.time} seconds`);
      sendResponse({ success: true });
    } else {
      console.error("Video element not found for seeking.");
      sendResponse({ error: "Video element not found." });
    }
    return true;
  }
});

let timeUpdateInterval = null;
let timeUpdatePort = null;

function sendVideoTime() {
  const videoElement = document.querySelector('video.html5-main-video');
  if (videoElement && timeUpdatePort) {
    try {
      timeUpdatePort.postMessage({
        action: "videoTimeUpdate",
        time: videoElement.currentTime,
        isPlaying: !videoElement.paused // Send playback state
      });
    } catch (e) {
      console.log("Port disconnected, stopping time updates.", e.message);
      if (timeUpdateInterval) {
        clearInterval(timeUpdateInterval);
        timeUpdateInterval = null;
      }
      timeUpdatePort = null;
    }
  } else if (!videoElement) {
    console.log("Video element not found for time update.");
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "transcriptSync") {
    timeUpdatePort = port;
    console.log("Popup connected for time sync.");

    if (timeUpdateInterval) {
      clearInterval(timeUpdateInterval);
    }
    timeUpdateInterval = setInterval(sendVideoTime, 750);

    port.onDisconnect.addListener(() => {
      console.log("Popup disconnected.");
      if (timeUpdateInterval) {
        clearInterval(timeUpdateInterval);
        timeUpdateInterval = null;
      }
      timeUpdatePort = null;
      if (chrome.runtime.lastError) {
        console.log("Port disconnect error:", chrome.runtime.lastError.message);
      }
    });
  }
});

console.log("YouTube Transcript Extractor content script loaded (v2).");