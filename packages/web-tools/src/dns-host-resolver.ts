import { lookup } from "node:dns/promises";
import type { HostResolver } from "./page-address";

/** Все адреса имени по системному DNS. */
export const dnsHostResolver: HostResolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address);
