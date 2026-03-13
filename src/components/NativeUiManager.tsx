import { useNativeUi } from "@/hooks/useNativeUi";
import { useTheme } from "./theme-context";

export function NativeUiManager() {
  const { theme } = useTheme();

  useNativeUi(theme);

  return null;
}

export default NativeUiManager;
