import { useNativeUi } from "@/hooks/useNativeUi";
import { useTheme } from "./ThemeProvider";

export function NativeUiManager() {
  const { theme } = useTheme();

  useNativeUi(theme);

  return null;
}

export default NativeUiManager;
