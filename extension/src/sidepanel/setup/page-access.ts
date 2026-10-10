// Chrome's activeTab access lasts only until the user follows a link to another
// site, and someone browsing hands-free cannot click the toolbar again after
// every link. So Iris asks once, from a button, for access to websites; Chrome
// keeps the grant until the user removes it. Access is used to read target
// positions and draw numbers on the page, never to send page content anywhere.
// The origins must stay within the manifest's optional_host_permissions.

export const PAGE_ACCESS: chrome.permissions.Permissions = {
  origins: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
};

export function hasPageAccess(): Promise<boolean> {
  return chrome.permissions.contains(PAGE_ACCESS);
}

/** Must be called directly from a click handler: Chrome only shows the prompt for a user gesture. */
export function requestPageAccess(): Promise<boolean> {
  return chrome.permissions.request(PAGE_ACCESS);
}

/** Calls `listener` with the current state now and whenever the user grants or removes access. */
export function watchPageAccess(listener: (granted: boolean) => void): () => void {
  const update = () => void hasPageAccess().then(listener);
  chrome.permissions.onAdded.addListener(update);
  chrome.permissions.onRemoved.addListener(update);
  update();
  return () => {
    chrome.permissions.onAdded.removeListener(update);
    chrome.permissions.onRemoved.removeListener(update);
  };
}

/** Side panel row showing whether Iris can follow the user across sites, with the one-time button. */
export function pageAccessPanel(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'page-access';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const allow = document.createElement('button');
  allow.textContent = 'Allow Iris on all websites';
  allow.addEventListener('click', () => {
    void requestPageAccess().catch(() => false);
  });
  watchPageAccess((granted) => {
    status.textContent = granted
      ? 'Iris can show numbers on every website you visit.'
      : 'Iris works only on this page until you allow it on all websites. Numbers stop after a link to another site.';
    allow.hidden = granted;
  });
  section.append(status, allow);
  return section;
}
