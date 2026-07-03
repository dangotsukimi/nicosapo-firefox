const WATCHED_COMMUNITIES_KEY = "watchedCommunities";

async function getWatchedCommunities() {
  const result = await browser.storage.local.get(WATCHED_COMMUNITIES_KEY);
  const data = result[WATCHED_COMMUNITIES_KEY] || [];
  return data
    .filter(item => {
      const id = typeof item === 'string' ? item : item.id;
      return !id.startsWith('co'); // Filter out old communities
    })
    .map(item => {
      if (typeof item === 'string') {
        return { id: item, title: item, thumbnail: '' };
      }
      return item;
    });
}

async function setWatchedCommunities(communities) {
  await browser.storage.local.set({ [WATCHED_COMMUNITIES_KEY]: communities });
}

async function fetchCommunityInfo(id) {
  let url = '';
  if (/^\d+$/.test(id)) {
    // Pure numbers mean a user ID
    url = `https://www.nicovideo.jp/user/${id}`;
  } else {
    // String (like 'ch12345' or 'imas-music') means channel
    url = `https://ch.nicovideo.jp/${id}`;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) return { id, title: id, thumbnail: '' };
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const titleObj = doc.querySelector('meta[property="og:title"]');
    const imgObj = doc.querySelector('meta[property="og:image"]');
    
    let title = titleObj ? titleObj.content : id;
    let thumbnail = imgObj ? imgObj.content : '';
    
    // Niconico's og:title for communities usually has " - ニコニコミュニティ" at the end, let's clean it up slightly if needed, or leave it.
    title = title.replace(' - ニコニコチャンネル', '').replace(' - ニコニコミュニティ', '');

    return { id, title, thumbnail };
  } catch(e) {
    return { id, title: id, thumbnail: '' };
  }
}

async function renderList() {
  const communities = await getWatchedCommunities();
  const listElement = document.getElementById("community-list");
  listElement.innerHTML = "";
  
  for (const community of communities) {
    const li = document.createElement("li");
    li.className = "listgroup-item";
    
    const infoDiv = document.createElement("div");
    infoDiv.className = "community-info";
    
    if (community.thumbnail) {
      const img = document.createElement("img");
      img.src = community.thumbnail;
      infoDiv.appendChild(img);
    }
    
    const textDiv = document.createElement("div");
    const titleSpan = document.createElement("span");
    titleSpan.className = "community-title";
    titleSpan.textContent = community.title;
    
    const idSpan = document.createElement("span");
    idSpan.className = "community-id";
    idSpan.textContent = community.id;
    
    textDiv.appendChild(titleSpan);
    textDiv.appendChild(idSpan);
    infoDiv.appendChild(textDiv);
    
    li.appendChild(infoDiv);
    
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "削除";
    deleteBtn.className = "btn-danger";
    deleteBtn.onclick = async () => {
      const newCommunities = communities.filter(c => c.id !== community.id);
      await setWatchedCommunities(newCommunities);
      renderList();
    };
    
    li.appendChild(deleteBtn);
    listElement.appendChild(li);
  }
}

function parseInputId(input) {
  let id = input.trim();
  try {
    const url = new URL(id);
    if (url.hostname.includes('ch.nicovideo.jp')) {
      id = url.pathname.replace(/^\//, '').split('/')[0];
    } else if (url.hostname.includes('nicovideo.jp') && url.pathname.startsWith('/user/')) {
      id = url.pathname.split('/')[2];
    } else if (url.hostname.includes('live.nicovideo.jp') && url.pathname.startsWith('/watch/user/')) {
      id = url.pathname.split('/')[3];
    }
  } catch (e) {
    // Not a URL, use as is
  }
  
  // Remove any trailing slashes or queries just in case
  id = id.split('?')[0].replace(/\/$/, '');
  return id;
}

document.getElementById("add-btn").addEventListener("click", async () => {
  const input = document.getElementById("community-id");
  const btn = document.getElementById("add-btn");
  const id = parseInputId(input.value);
  
  if (!id) return;
  
  const communities = await getWatchedCommunities();
  if (!communities.find(c => c.id === id)) {
    btn.textContent = "追加中...";
    btn.disabled = true;
    
    const info = await fetchCommunityInfo(id);
    communities.push(info);
    await setWatchedCommunities(communities);
    renderList();
    
    btn.textContent = "追加";
    btn.disabled = false;
  }
  
  
  input.value = "";
});

// Setup settings sync
async function initSettings() {
  const result = await browser.storage.local.get(["autoEnterEnable", "notificationEnable"]);
  const autoEnterEnable = result.autoEnterEnable !== false; // default true
  const notificationEnable = result.notificationEnable !== false; // default true
  
  document.querySelector(`input[name="autoEnterEnable"][value="${autoEnterEnable}"]`).checked = true;
  document.querySelector(`input[name="notificationEnable"][value="${notificationEnable}"]`).checked = true;
  
  document.querySelectorAll('input[name="autoEnterEnable"]').forEach(el => {
    el.addEventListener('change', async (e) => {
      await browser.storage.local.set({ autoEnterEnable: e.target.value === 'true' });
    });
  });
  
  document.querySelectorAll('input[name="notificationEnable"]').forEach(el => {
    el.addEventListener('change', async (e) => {
      await browser.storage.local.set({ notificationEnable: e.target.value === 'true' });
    });
  });
}

// Initial render
document.addEventListener("DOMContentLoaded", () => {
  renderList();
  initSettings();
});
