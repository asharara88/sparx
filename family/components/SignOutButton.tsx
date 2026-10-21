import { SignOutForm } from "./SignOutForm";

export function SignOutButton() {
  return (
    <SignOutForm>
      <button className="btn w-full" type="submit">
        Sign out
      </button>
    </SignOutForm>
  );
}
