import { buildASTSchema, validate, parse } from 'graphql';
import { typeDefs } from '../schema';

// Schema-shape guards built straight from the SDL the server serves (no
// resolvers / DB needed). These lock in the removal of the unauthenticated
// Query.user(id) field — a broken-object-level-authorization hole that
// returned any user's email + subscription + rides — so it can't silently
// come back.
describe('GraphQL schema — Query.user removal', () => {
  const schema = buildASTSchema(typeDefs);

  it('does not expose a Query.user field', () => {
    const queryFields = schema.getQueryType()?.getFields() ?? {};
    expect(queryFields.user).toBeUndefined();
  });

  it('still exposes Query.me (the intended self-lookup)', () => {
    const queryFields = schema.getQueryType()?.getFields() ?? {};
    expect(queryFields.me).toBeDefined();
  });

  it('rejects a query selecting user(id) at validation time', () => {
    const errors = validate(schema, parse('{ user(id: "any") { id email } }'));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map((e) => e.message).join('\n')).toMatch(/Cannot query field "user"/);
  });
});
