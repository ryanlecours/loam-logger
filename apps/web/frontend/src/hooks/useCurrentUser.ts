import { useQuery } from "@apollo/client";
import { ME_QUERY } from "@/graphql/me";

export function useCurrentUser() {
  const { data, loading, error } = useQuery(ME_QUERY, { fetchPolicy: "cache-first" });
  return { user: data?.me, loading, error };
}
