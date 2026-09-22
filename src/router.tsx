import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Keep the current route/data active when the user switches browser tabs.
    // Explicit navigation or query invalidation can still refresh data.
    defaultStaleTime: Infinity,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
