import { redirect } from "next/navigation";

/**
 * Root entry point. The product lives at the tool route, so the root
 * permanently redirects into the workstation. Kept a server component so the
 * redirect is issued before any client JS ships.
 */
export default function Home() {
  redirect("/tools/anchorflow");
}
