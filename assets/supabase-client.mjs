import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';

export async function createBrowserClient() {
  try {
    const response = await fetch('/.netlify/functions/evidence-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Public configuration unavailable');
    const { url, key } = await response.json();
    return createClient(url, key);
  } catch {
    const notice = document.getElementById('message') || document.getElementById('signed-in-email');
    if (notice) notice.textContent = 'Account configuration could not load. Refresh the page or try again later.';
    throw new Error('Account configuration unavailable.');
  }
}
