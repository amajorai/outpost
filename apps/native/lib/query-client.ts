import { QueryClient } from "@tanstack/react-query";

/** Shared TanStack Query client for the companion app. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: 1,
    },
  },
});
