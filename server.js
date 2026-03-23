const useSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)

if (useSupabase) {
  require("./server-supabase")
} else {
  require("./server-sqlite")
}
