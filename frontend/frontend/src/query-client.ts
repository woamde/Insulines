// One QueryClient for the whole app; the provider in app/_layout.tsx uses
// this instance. Import it for cache calls outside components, for example
// queryClient.invalidateQueries or setQueryData in websocket or push
// handlers; inside components useQueryClient() returns this same instance.
import { QueryClient } from "@tanstack/react-query";
import { Platform } from "react-native";

export const queryClient = new QueryClient({
  defaultOptions: {
    // The PWA is online-only: fail a new write immediately rather than silently
    // queuing a medical record to be sent later when the browser reconnects.
    mutations: { networkMode: Platform.OS === "web" ? "always" : "online" },
  },
});
