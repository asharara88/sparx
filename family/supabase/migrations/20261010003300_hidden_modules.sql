-- Modules the household has switched off. Permissions and data stay as they are;
-- the app simply does not show these modules to anyone. Switch one back on by
-- taking it out of the list. elnunu is the little one's day, so the shopping loop
-- and the cat's log start off hidden.
alter table public.household add column if not exists hidden_modules text[] not null default '{}';
update public.household set hidden_modules = '{shopping,fanta}' where hidden_modules = '{}';
