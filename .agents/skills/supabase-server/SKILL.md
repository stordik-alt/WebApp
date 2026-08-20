---
name: supabase-server
description: This skill should be used when the user asks to "work with Supabase Server SDK", "create Supabase user", "manage Supabase authentication", "use supabase/server package", or mentions Supabase backend operations. Provides guidance for working with @supabase/server package for server-side operations.
---

## Supabase Server SDK Skill

This skill provides guidance for working with the Supabase Server SDK (`@supabase/server`) for server-side operations.

### When to Use This Skill

Use this skill when:
- The user asks to create/manage Supabase users programmatically
- Working with Supabase Auth from server-side code
- Need to use service role keys for admin operations
- Managing Supabase database from backend services

### Key Concepts

1. **@supabase/server** - Server-side SDK with service role access
2. **Service Role Key** - Full admin access to Supabase (never expose in client code)
3. **Supabase Auth** - User management with email/password, OAuth, etc.

### Setup

The project has already installed `@supabase/server` and configured environment variables:

```bash
SUPABASE_URL=https://pksuuhvkdxcbguhpmycn.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_X79eIjVA38i5zlDRPyLwQQ_8NIOGgQP
```

### Creating a Supabase Client

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

### Common Operations

#### Create User
```typescript
const { data, error } = await supabase.auth.admin.createUser({
  email: 'user@example.com',
  password: 'password123',
  email_confirmed_at: new Date().toISOString(),
  raw_user_meta_data: {
    first_name: 'John',
    last_name: 'Doe'
  }
});
```

#### Set User Role
```typescript
const { data, error } = await supabase
  .from('user_roles')
  .insert({ user_id: userId, role: 'admin' });
```

#### Get User
```typescript
const { data, error } = await supabase.auth.admin.getUser(userId);
```

#### Delete User
```typescript
const { data, error } = await supabase.auth.admin.deleteUser(userId);
```

### Security Best Practices

1. **Never commit service role keys** - They're in `.env` and `.gitignore`
2. **Use service role only on server** - Client-side uses publishable key
3. **Validate user input** - Always validate before database operations
4. **Handle errors properly** - Check for auth errors and database errors

### Project-Specific Notes

- User roles are stored in `public.user_roles` table
- Role types: `admin`, `team_leader`, `operator`
- Use `ensure_profile` RPC function to create user profiles

### Additional Resources

For more details, see:
- [Supabase Server SDK Docs](https://supabase.com/docs/reference/server/introduction)
- [Auth Admin Methods](https://supabase.com/docs/reference/auth/admin)
