// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const extractBtn = document.getElementById('extractBtn');
  const copyBtn = document.getElementById('copyBtn');
  const transcriptContainer = document.getElementById('transcriptContainer');
  const statusDiv = document.getElementById('status');
  const syncControlDiv = document.getElementById('syncControl');
  const syncToggle = document.getElementById('syncToggle');

  let fullTranscriptText = "";
  let transcriptSegmentsData = []; // To store { timestamp, text, startSeconds, element }
  let currentVideoTime = 0;
  let activeSegmentElement = null;
  let timeSyncPort = null;
  let isSyncEnabled = true; // Default to true, controlled by checkbox

  // Helper to convert HH:MM:SS or MM:SS to seconds
  function timestampToSeconds(timestamp) {
    const parts = timestamp.split(':').map(Number);
    let seconds = 0;
    if (parts.length === 3) { // HH:MM:SS
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) { // MM:SS
      seconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 1) { // SS
      seconds = parts[0];
    }
    return seconds;
  }

  function renderTranscript(segments) {
    transcriptContainer.innerHTML = ''; // Clear previous content
    transcriptSegmentsData = [];
    fullTranscriptText = ""; // Reset full text for copy
    let segmentIdCounter = 0;

    if (!segments || segments.length === 0) {
      transcriptContainer.textContent = 'No transcript segments found.';
      syncControlDiv.style.display = 'none';
      return;
    }

    segments.forEach(segment => {
      const segmentDiv = document.createElement('div');
      segmentDiv.classList.add('transcript-segment');
      segmentDiv.id = `segment-${segmentIdCounter++}`;

      const timestampSpan = document.createElement('span');
      timestampSpan.classList.add('timestamp');
      timestampSpan.textContent = segment.timestamp;
      segmentDiv.appendChild(timestampSpan);

      const textSpan = document.createElement('span');
      textSpan.classList.add('text');
      textSpan.textContent = segment.text;
      segmentDiv.appendChild(textSpan);

      transcriptContainer.appendChild(segmentDiv);

      transcriptSegmentsData.push({
        timestamp: segment.timestamp,
        text: segment.text,
        startSeconds: timestampToSeconds(segment.timestamp),
        element: segmentDiv
      });

      // Prepare full text for copy
      fullTranscriptText += `${segment.timestamp}\n${segment.text}\n\n`;
    });
    syncControlDiv.style.display = 'block';
    copyBtn.style.display = 'inline-block';
    statusDiv.textContent = 'Transcript extracted!';
    updateActiveSegment(); // Initial update based on current time (likely 0)
  }

  function updateActiveSegment() {
    if (!isSyncEnabled || transcriptSegmentsData.length === 0) {
      // If sync is disabled, remove any active class
      if (activeSegmentElement) {
        activeSegmentElement.classList.remove('active');
        activeSegmentElement = null;
      }
      return;
    }

    let newActiveSegment = null;
    // Find the segment that is currently active
    // Iterate backwards as it's more likely the later segments are active
    for (let i = transcriptSegmentsData.length - 1; i >= 0; i--) {
      if (currentVideoTime >= transcriptSegmentsData[i].startSeconds) {
        newActiveSegment = transcriptSegmentsData[i].element;
        break;
      }
    }
    // If no segment is found (e.g., video time is before the first timestamp),
    // default to the first segment or none. For now, let's pick first if time is < first segment time.
    if (!newActiveSegment && transcriptSegmentsData.length > 0 && currentVideoTime < transcriptSegmentsData[0].startSeconds) {
        // newActiveSegment = transcriptSegmentsData[0].element; // Or leave null to not highlight anything before start
    }


    if (newActiveSegment && newActiveSegment !== activeSegmentElement) {
      if (activeSegmentElement) {
        activeSegmentElement.classList.remove('active');
      }
      newActiveSegment.classList.add('active');
      activeSegmentElement = newActiveSegment;

      // Scroll to the active segment
      // 'center' tries to put it in the middle, 'nearest' is also an option
      activeSegmentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (!newActiveSegment && activeSegmentElement) {
        // If currentVideoTime is before any known segment, remove highlight
        activeSegmentElement.classList.remove('active');
        activeSegmentElement = null;
    }
  }


  function connectToContentScript() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        if (timeSyncPort) {
          try { timeSyncPort.disconnect(); } catch (e) {/*ignore*/ }
        }
        timeSyncPort = chrome.tabs.connect(tabs[0].id, { name: "transcriptSync" });
        timeSyncPort.onMessage.addListener((msg) => {
          if (msg.action === "videoTimeUpdate") {
            currentVideoTime = msg.time;
            // console.log("Popup received time:", currentVideoTime);
            if (isSyncEnabled) {
                 updateActiveSegment();
            }
          }
        });
        timeSyncPort.onDisconnect.addListener(() => {
          console.log("Popup port disconnected.");
          timeSyncPort = null;
          if (chrome.runtime.lastError) {
            console.log("Popup port disconnect error:", chrome.runtime.lastError.message);
          }
          // Optionally try to reconnect or notify user
        });
      }
    });
  }

  extractBtn.addEventListener('click', async () => {
    transcriptContainer.textContent = 'Extracting...';
    statusDiv.textContent = '';
    copyBtn.style.display = 'none';
    syncControlDiv.style.display = 'none';
    fullTranscriptText = "";
    if (activeSegmentElement) {
      activeSegmentElement.classList.remove('active');
      activeSegmentElement = null;
    }
    transcriptSegmentsData = [];


    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (tab && tab.url && tab.url.includes("youtube.com/watch")) {
        chrome.tabs.sendMessage(tab.id, { action: "extractTranscript" }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Error sending message:", chrome.runtime.lastError.message);
            transcriptContainer.textContent = "Error: Could not communicate with the YouTube page. Refresh & try again.";
            statusDiv.textContent = chrome.runtime.lastError.message;
            return;
          }

          if (response && response.transcript) {
            renderTranscript(response.transcript);
            if (response.transcript.length > 0) {
                isSyncEnabled = syncToggle.checked; // Use current checkbox state
                if (isSyncEnabled) {
                    connectToContentScript(); // Establish connection for time updates
                }
            }
          } else if (response && response.error) {
            transcriptContainer.textContent = response.error;
            statusDiv.textContent = `Error: ${response.error}`;
          } else {
            transcriptContainer.textContent = 'Failed to extract transcript. Ensure transcript panel is open or can be opened.';
            statusDiv.textContent = 'Extraction failed.';
          }
        });
      } else {
        transcriptContainer.textContent = 'Not a YouTube video page.';
        statusDiv.textContent = 'Please navigate to a YouTube video.';
      }
    } catch (error) {
      console.error("Popup script error:", error);
      transcriptContainer.textContent = "An unexpected error occurred.";
      statusDiv.textContent = `Error: ${error.message}`;
    }
  });

  copyBtn.addEventListener('click', () => {
    if (fullTranscriptText) {
      navigator.clipboard.writeText(fullTranscriptText.trim())
        .then(() => {
          statusDiv.textContent = 'Transcript copied to clipboard!';
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; }, 2000);
        })
        .catch(err => {
          console.error('Failed to copy transcript: ', err);
          statusDiv.textContent = 'Failed to copy.';
        });
    }
  });

  syncToggle.addEventListener('change', (event) => {
    isSyncEnabled = event.target.checked;
    if (isSyncEnabled) {
      if (!timeSyncPort && transcriptSegmentsData.length > 0) {
        // If port isn't active (e.g., was disabled, now re-enabled) and transcript exists
        connectToContentScript();
      }
      updateActiveSegment(); // Immediately update based on current time
    } else {
      // If sync is disabled, remove highlight
      if (activeSegmentElement) {
        activeSegmentElement.classList.remove('active');
        activeSegmentElement = null; // Don't clear it from DOM, just the 'active' state
      }
      // Optionally, disconnect the port if not needed for anything else
      // if (timeSyncPort) {
      //   timeSyncPort.disconnect();
      //   timeSyncPort = null;
      // }
    }
  });

  // When popup closes, the port connection handled by content.js's onDisconnect
  // will automatically stop the interval in content.js.
  // No explicit disconnect needed here on window unload for *that* purpose,
  // but good practice if we had other resources.
  // window.addEventListener('unload', () => {
  //   if (timeSyncPort) {
  //     timeSyncPort.disconnect();
  //   }
  // });
});