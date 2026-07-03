const OPENED_PROGRAMS_KEY = "openedPrograms";
const WATCHED_COMMUNITIES_KEY = "watchedCommunities";

async function getWatchedCommunities() {
  const result = await browser.storage.local.get(WATCHED_COMMUNITIES_KEY);
  return result[WATCHED_COMMUNITIES_KEY] || [];
}

async function getOpenedPrograms() {
  const result = await browser.storage.local.get(OPENED_PROGRAMS_KEY);
  return result[OPENED_PROGRAMS_KEY] || [];
}

async function setOpenedPrograms(programs) {
  // Keep only recent ones to avoid infinite growth
  // Assuming programs is an array of IDs
  const limit = 100;
  const recentPrograms = programs.slice(-limit);
  await browser.storage.local.set({ [OPENED_PROGRAMS_KEY]: recentPrograms });
}

let isChecking = false;

async function checkStreams() {
  if (isChecking) return;
  isChecking = true;

  try {
    const result = await browser.storage.local.get(["autoEnterEnable", "notificationEnable"]);
    if (result.autoEnterEnable === false) {
      return;
    }
    const isNotificationEnabled = result.notificationEnable !== false;

  const communities = await getWatchedCommunities();
  const openedPrograms = await getOpenedPrograms();
  let updatedOpenedPrograms = [...openedPrograms];

  for (const community of communities) {
    const communityId = typeof community === 'string' ? community : community.id;
    try {
      let programId = null;

      if (!/^\d+$/.test(communityId)) {
        // 1a. Channel - use internal social_group API (relies on browser cookies for access)
        try {
          const latestProgramResponse = await fetch(`https://live2.nicovideo.jp/unama/tool/v1/broadcasters/social_group/${communityId}/program`);
          if (latestProgramResponse.ok) {
            const latestProgramData = await latestProgramResponse.json();
            if (latestProgramData.meta && latestProgramData.meta.status === 200 && latestProgramData.data.nicoliveProgramId) {
              programId = latestProgramData.data.nicoliveProgramId;
            }
          }
        } catch(e) {
          console.error(`Error checking channel ${communityId}:`, e);
        }
      } else {
        // 1b. For users (numeric ID)
        // Try the front API first
        try {
          const historyRes = await fetch(`https://live.nicovideo.jp/front/api/v1/user-broadcast-history?providerId=${communityId}`);
          if (historyRes.ok) {
            const historyData = await historyRes.json();
            const liveProgram = historyData.data?.programsList?.find(p => p.program?.status === "ON_AIR");
            if (liveProgram) {
              programId = liveProgram.id.value;
            }
          }
        } catch(e) {}

        if (!programId) {
          // Fallback to watch/user/ page
          const userWatchResponse = await fetch(`https://live.nicovideo.jp/watch/user/${communityId}`);
          const finalUrl = userWatchResponse.url;
          
          if (finalUrl && finalUrl.includes('/watch/lv')) {
            programId = finalUrl.split('/watch/')[1].split('?')[0];
          } else if (userWatchResponse.ok) {
            const html = await userWatchResponse.text();
            const metaMatch = html.match(/content="\d+;url=https:\/\/live\.nicovideo\.jp\/watch\/(lv\d+)[^"]*"/);
            if (metaMatch) {
              programId = metaMatch[1];
            } else {
              const dataPropsMatch = html.match(/data-props="([^"]+)"/);
              if (dataPropsMatch) {
                try {
                  const propsStr = dataPropsMatch[1].replace(/&quot;/g, '"');
                  const props = JSON.parse(propsStr);
                  if (props.program && props.program.nicoliveProgramId) {
                    programId = props.program.nicoliveProgramId;
                  }
                } catch (e) {}
              }
            }
          }
        }
      }

      if (!programId) {
        continue;
      }

      // Check if we already opened it
      if (updatedOpenedPrograms.includes(programId)) {
        continue;
      }

      // 2. Get program status
      const programStatusResponse = await fetch(`https://live2.nicovideo.jp/unama/watch/${programId}/programinfo`);
      const programStatusData = await programStatusResponse.json();

      if (programStatusData.meta.status === 200 && programStatusData.data.status === "onAir") {
        const title = programStatusData.data.title || "放送";

        // Create a notification if enabled
        if (isNotificationEnabled) {
          browser.notifications.create({
            type: "basic",
            iconUrl: browser.runtime.getURL("images/icon.png"),
            title: "ニコ生自動入場",
            message: `番組へ自動入場します: ${title}`
          });
        }

        // 3. Open in a new tab
        await browser.tabs.create({ url: `https://live.nicovideo.jp/watch/${programId}` });
        
        // 4. Record as opened
        updatedOpenedPrograms.push(programId);
      }
    } catch (error) {
      console.error(`Error checking community ${communityId}:`, error);
    }
  }

    // Save updated opened programs
    if (updatedOpenedPrograms.length !== openedPrograms.length) {
      await setOpenedPrograms(updatedOpenedPrograms);
    }
  } finally {
    isChecking = false;
  }
}

// Check every 30 seconds
setInterval(checkStreams, 30000);

// Run once on startup
checkStreams();

// Handle extension icon click to open settings in a full tab
browser.browserAction.onClicked.addListener(() => {
  browser.tabs.create({ url: browser.runtime.getURL("options.html") });
});
