export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button className="btn w-full" type="submit">
        Sign out
      </button>
    </form>
  );
}
