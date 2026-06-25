const FB_GRAPH = "https://graph.facebook.com/v23.0";

export function facebookAvailable() {
  return !!(process.env.FACEBOOK_PAGE_TOKEN && process.env.FACEBOOK_PAGE_ID);
}

export function instagramAvailable() {
  return !!(process.env.FACEBOOK_PAGE_TOKEN && process.env.INSTAGRAM_USER_ID);
}

export async function postToFacebook({ message, imageUrl }) {
  const pageId = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_TOKEN;

  let endpoint, body;
  if (imageUrl) {
    endpoint = `${FB_GRAPH}/${pageId}/photos`;
    body = { caption: message, url: imageUrl, access_token: token };
  } else {
    endpoint = `${FB_GRAPH}/${pageId}/feed`;
    body = { message, access_token: token };
  }

  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Facebook: ${json.error?.message || json.message || r.status}`);
  }
  return json;
}

export async function postToInstagram({ caption, imageUrl }) {
  const igUserId = process.env.INSTAGRAM_USER_ID;
  const token = process.env.FACEBOOK_PAGE_TOKEN;

  if (!imageUrl) throw new Error("Instagram requires an image URL");

  // Step 1: create media container
  const containerRes = await fetch(`${FB_GRAPH}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_url: imageUrl, caption, access_token: token }),
  });
  const container = await containerRes.json().catch(() => ({}));
  if (!containerRes.ok) {
    throw new Error(`Instagram container: ${container.error?.message || containerRes.status}`);
  }

  // Step 2: publish the container
  const publishRes = await fetch(`${FB_GRAPH}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: container.id, access_token: token }),
  });
  const publish = await publishRes.json().catch(() => ({}));
  if (!publishRes.ok) {
    throw new Error(`Instagram publish: ${publish.error?.message || publishRes.status}`);
  }
  return publish;
}
