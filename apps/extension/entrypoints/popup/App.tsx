import { useEffect, useState } from "react";
import { BRIDGE_TOKEN_STORAGE_KEY } from "../../lib/detection";
import "./App.css";

/**
 * Popup for the one-time bridge-token setup.
 *
 * The desktop bridge requires a per-install token on every request. The user
 * copies it from Outpost (Settings → Browser extension) and pastes it here; we
 * store it in `browser.storage.local` for the background worker to send on each
 * detected-post delivery.
 */
function App() {
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    browser.storage.local
      .get(BRIDGE_TOKEN_STORAGE_KEY)
      .then((stored) => {
        const value = stored[BRIDGE_TOKEN_STORAGE_KEY];
        if (typeof value === "string") {
          setToken(value);
        }
      })
      .catch(() => {
        // No stored token yet; leave the field empty.
      });
  }, []);

  const handleSave = async () => {
    await browser.storage.local.set({
      [BRIDGE_TOKEN_STORAGE_KEY]: token.trim(),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <main className="outpost-popup">
      <h1>Outpost</h1>
      <p>
        Paste the bridge token from Outpost (Settings → Browser extension) so
        detected posts can reach the desktop app.
      </p>
      <label htmlFor="bridge-token">Bridge token</label>
      <input
        autoComplete="off"
        id="bridge-token"
        onChange={(event) => setToken(event.target.value)}
        placeholder="Paste token here"
        type="password"
        value={token}
      />
      <button onClick={handleSave} type="button">
        {saved ? "Saved" : "Save"}
      </button>
    </main>
  );
}

export default App;
