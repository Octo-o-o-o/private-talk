import { useEffect } from "react";
import { AppLayout } from "./components/layout/AppLayout";
import { PinLock } from "./components/pin/PinLock";
import { useAppStore } from "./stores/appStore";

function App() {
  const { isLocked, pinEnabled, checkPinStatus, loadConversations, loadProviders } =
    useAppStore();

  useEffect(() => {
    const init = async () => {
      await checkPinStatus();
      await loadConversations();
      await loadProviders();
    };
    init();
  }, [checkPinStatus, loadConversations, loadProviders]);

  if (pinEnabled && isLocked) {
    return <PinLock />;
  }

  return <AppLayout />;
}

export default App;
