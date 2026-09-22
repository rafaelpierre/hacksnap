import { Mail } from "lucide-react";
import { FaXTwitter, FaRedditAlien, FaWhatsapp, FaFacebookF, FaLinkedinIn } from "react-icons/fa6";

export function ShareLinks({id, title}: {id: string; title: string}) {
  const url = encodeURIComponent(`https://hacksnap.live/story/${id}`);
  const text = encodeURIComponent(title);
  const links = [
    {name: "X (Twitter)", Icon: FaXTwitter, href: `https://twitter.com/intent/tweet?url=${url}&text=${text}`},
    {name: "Reddit", Icon: FaRedditAlien, href: `https://www.reddit.com/submit?url=${url}&title=${text}`},
    {name: "WhatsApp", Icon: FaWhatsapp, href: `https://wa.me/?text=${text}%20${url}`},
    {name: "Facebook", Icon: FaFacebookF, href: `https://www.facebook.com/sharer/sharer.php?u=${url}`},
    {name: "LinkedIn", Icon: FaLinkedinIn, href: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`},
    {name: "Email", Icon: Mail, href: `mailto:?subject=${text}&body=${text}%0D%0A%0D%0A${url}`},
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
  </div>;
}
