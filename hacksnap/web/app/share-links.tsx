import { Mail } from "lucide-react";
import { FaXTwitter, FaRedditAlien, FaWhatsapp, FaFacebookF, FaLinkedinIn } from "react-icons/fa6";
import { shareText } from "../lib/share-text";
import { CopySharePost } from "./copy-share-post";

export function ShareLinks({id, title, takeaway}: {id: string; title: string; takeaway?: string | null}) {
  const draft = (source: string) => shareText(id, title, takeaway, source);
  const url = (source: string) => encodeURIComponent(draft(source).url);
  const text = encodeURIComponent(title);
  const links = [
    {name: "X (Twitter)", Icon: FaXTwitter, href: `https://twitter.com/intent/tweet?url=${url("x")}&text=${encodeURIComponent(draft("x").tweet)}`},
    {name: "Reddit", Icon: FaRedditAlien, href: `https://www.reddit.com/submit?url=${url("reddit")}&title=${text}`},
    {name: "WhatsApp", Icon: FaWhatsapp, href: `https://wa.me/?text=${encodeURIComponent(draft("whatsapp").post)}`},
    {name: "Facebook", Icon: FaFacebookF, href: `https://www.facebook.com/sharer/sharer.php?u=${url("facebook")}`},
    {name: "LinkedIn", Icon: FaLinkedinIn, href: `https://www.linkedin.com/sharing/share-offsite/?url=${url("linkedin")}`},
    {name: "Email", Icon: Mail, href: `mailto:?subject=${text}&body=${encodeURIComponent(draft("email").post.replaceAll("\n", "\r\n"))}`},
  ];
  return <div className="share-links" role="group" aria-label={`Share ${title}`}>
    {links.map(({name, Icon, href}) => <a
      key={name}
      className="share-link"
      href={href}
      target={name === "Email" ? undefined : "_blank"}
      rel={name === "Email" ? undefined : "noopener noreferrer"}
      aria-label={name === "Email" ? `Share by email: ${title}` : `Share on ${name}: ${title} (opens in a new tab)`}
    >
      <Icon size={15} aria-hidden="true" focusable="false" />
      <span className="share-tooltip" aria-hidden="true">{name}</span>
    </a>)}
    <CopySharePost text={draft("copy").post} />
  </div>;
}
