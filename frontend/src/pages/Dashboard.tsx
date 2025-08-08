import { gql, useQuery } from '@apollo/client';
import type { User } from '../models/User';

const TEST_QUERY = gql`
 query {
    users {
      id
      email
    }
  }
 `

export default function Dashboard() {
    const { data, loading, error } = useQuery(TEST_QUERY);

  if (loading) return <p>Loading…</p>;
  if (error) return <p>Error: {error.message}</p>;
  return (<><h1 className="text-2xl text-center">Your Dashboard</h1><div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Users</h1>
      <ul className="space-y-2">
          {data.users.map((user: User) => (
              <li key={user.id} className="border p-2 rounded">
                  <p className="font-semibold">{user.id}</p>
                  <p className="text-sm text-gray-600">{user.email}</p>
              </li>
          ))}
      </ul>
  </div></>
  );
}