//! Which URLs and addresses a capture may reach. Everything here is pure: the same rules gate the
//! requested URL, every redirect hop and every DNS answer.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use reqwest::Url;

use super::wire::FailureReason;

/// For the typed URL, its normalized form and every redirect target.
pub(super) const MAX_URL_BYTES: usize = 2048;

/// `(network, mask)` pairs that are not the public internet.
const NON_PUBLIC_IPV4: [(u32, u32); 14] = [
    (0x0000_0000, 0xff00_0000), // 0.0.0.0/8 "this network"
    (0x0a00_0000, 0xff00_0000), // 10.0.0.0/8 private
    (0x6440_0000, 0xffc0_0000), // 100.64.0.0/10 shared address space (CGNAT)
    (0x7f00_0000, 0xff00_0000), // 127.0.0.0/8 loopback
    (0xa9fe_0000, 0xffff_0000), // 169.254.0.0/16 link-local, including cloud metadata
    (0xac10_0000, 0xfff0_0000), // 172.16.0.0/12 private
    (0xc000_0000, 0xffff_ff00), // 192.0.0.0/24 IETF protocol assignments
    (0xc000_0200, 0xffff_ff00), // 192.0.2.0/24 documentation
    (0xc058_6300, 0xffff_ff00), // 192.88.99.0/24 deprecated 6to4 relay anycast
    (0xc0a8_0000, 0xffff_0000), // 192.168.0.0/16 private
    (0xc612_0000, 0xfffe_0000), // 198.18.0.0/15 benchmarking
    (0xc633_6400, 0xffff_ff00), // 198.51.100.0/24 documentation
    (0xcb00_7100, 0xffff_ff00), // 203.0.113.0/24 documentation
    (0xe000_0000, 0xe000_0000), // 224.0.0.0/3 multicast, reserved and broadcast
];

/// Which addresses a connection may use. Production code can only name `Public`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AddressPolicy {
    Public,
    /// The loopback test server, in addition to public addresses. Test builds only.
    #[cfg(test)]
    PublicOrLoopback,
}

impl AddressPolicy {
    pub(super) fn allows(self, address: IpAddr) -> bool {
        match self {
            Self::Public => is_public(address),
            #[cfg(test)]
            Self::PublicOrLoopback => is_public(address) || address.is_loopback(),
        }
    }
}

pub(super) fn is_public(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_public_v4(address),
        IpAddr::V6(address) => is_public_v6(address),
    }
}

fn is_public_v4(address: Ipv4Addr) -> bool {
    let value = u32::from(address);
    !NON_PUBLIC_IPV4
        .iter()
        .any(|(network, mask)| value & mask == *network)
}

/// Only global unicast, minus the special-purpose blocks inside it. Mapped and NAT64 addresses
/// reach an IPv4 host, so they are judged by that host.
fn is_public_v6(address: Ipv6Addr) -> bool {
    if let Some(embedded) = address.to_ipv4_mapped() {
        return is_public_v4(embedded);
    }
    let segments = address.segments();
    if segments[..6] == [0x0064, 0xff9b, 0, 0, 0, 0] {
        let [a, b] = segments[6].to_be_bytes();
        let [c, d] = segments[7].to_be_bytes();
        return is_public_v4(Ipv4Addr::new(a, b, c, d));
    }
    let global_unicast = segments[0] & 0xe000 == 0x2000; // 2000::/3
    let ietf_protocol = segments[0] == 0x2001 && segments[1] & 0xfe00 == 0; // 2001::/23
    let documentation = segments[0] == 0x2001 && segments[1] == 0x0db8; // 2001:db8::/32
    let six_to_four = segments[0] == 0x2002; // 2002::/16
    let documentation_wide = segments[0] == 0x3fff && segments[1] & 0xf000 == 0; // 3fff::/20
    global_unicast && !ietf_protocol && !documentation && !six_to_four && !documentation_wide
}

/// Where a URL's host points, as the WHATWG parser normalized it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Target {
    Address(IpAddr),
    Name(String),
}

/// The typed URL: absolute http(s), no credentials, no fragment, and a host that may be public.
pub(super) fn parse_request(
    input: &str,
    policy: AddressPolicy,
) -> Result<(Url, Target), FailureReason> {
    if input.len() > MAX_URL_BYTES {
        return Err(FailureReason::InvalidUrl);
    }
    let url = Url::parse(input).map_err(|_| FailureReason::InvalidUrl)?;
    gate(url, policy)
}

/// The next hop named by a redirect `Location`, held to the same rules and never downgraded.
pub(super) fn redirect_target(
    current: &Url,
    location: Option<&[u8]>,
    policy: AddressPolicy,
) -> Result<(Url, Target), FailureReason> {
    let location = location
        .and_then(|value| std::str::from_utf8(value).ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= MAX_URL_BYTES)
        .ok_or(FailureReason::InvalidRedirect)?;
    let next = current
        .join(location)
        .map_err(|_| FailureReason::InvalidRedirect)?;
    if current.scheme() == "https" && next.scheme() == "http" {
        return Err(FailureReason::InsecureRedirect);
    }
    gate(next, policy).map_err(|reason| match reason {
        FailureReason::InvalidUrl => FailureReason::InvalidRedirect,
        other => other,
    })
}

fn gate(mut url: Url, policy: AddressPolicy) -> Result<(Url, Target), FailureReason> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err(FailureReason::UnsupportedScheme);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(FailureReason::CredentialsInUrl);
    }
    url.set_fragment(None);
    if url.as_str().len() > MAX_URL_BYTES {
        return Err(FailureReason::InvalidUrl);
    }
    let target = target(&url).ok_or(FailureReason::InvalidUrl)?;
    let refused = match &target {
        Target::Address(address) => !policy.allows(*address),
        Target::Name(name) => is_local_name(name),
    };
    if refused {
        return Err(FailureReason::NotPublicAddress);
    }
    Ok((url, target))
}

/// reqwest re-exports `Url` but not `url::Host`, so this reads `host_str()`, whose form the parser
/// fixed for http(s): IPv6 is always bracketed, IPv4 is always dotted decimal (decimal, hex and
/// octal spellings are already converted), and a domain never ends in a number, so a domain can
/// never read as an IPv4 address here.
fn target(url: &Url) -> Option<Target> {
    let host = url.host_str().filter(|host| !host.is_empty())?;
    if let Some(inner) = host
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
    {
        return inner
            .parse::<Ipv6Addr>()
            .ok()
            .map(|address| Target::Address(address.into()));
    }
    if let Ok(address) = host.parse::<Ipv4Addr>() {
        return Some(Target::Address(address.into()));
    }
    Some(Target::Name(host.to_owned()))
}

/// Names that only ever mean this machine or its local network. The parser lowercased them.
fn is_local_name(name: &str) -> bool {
    let name = name.strip_suffix('.').unwrap_or(name);
    name == "localhost"
        || name.ends_with(".localhost")
        || name == "local"
        || name.ends_with(".local")
}
