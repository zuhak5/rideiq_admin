--
-- PostgreSQL database dump
--

\restrict pCeeb4riKtM2qPKnoQKXmvkvccz90GgNBpStrAP6IIxX8I8e93OvHylFfv6Jq8V

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.7

-- Started on 2026-02-07 19:24:22

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 5782 (class 0 OID 17264)
-- Dependencies: 392
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY storage.buckets (id, name, owner, created_at, updated_at, public, avif_autodetection, file_size_limit, allowed_mime_types, owner_id, type) FROM stdin;
avatars	avatars	\N	2026-01-24 12:33:05.071219+00	2026-01-24 12:33:05.071219+00	f	f	\N	\N	\N	STANDARD
kyc-documents	kyc-documents	\N	2026-01-24 12:33:05.071219+00	2026-01-24 12:33:05.071219+00	f	f	\N	\N	\N	STANDARD
chat-media	chat-media	\N	2026-01-24 12:33:05.071219+00	2026-01-24 12:33:05.071219+00	f	f	\N	\N	\N	STANDARD
driver-docs	driver-docs	\N	2026-01-26 00:32:47.231078+00	2026-01-26 00:32:47.231078+00	f	f	\N	\N	\N	STANDARD
\.


-- Completed on 2026-02-07 19:24:54

--
-- PostgreSQL database dump complete
--

\unrestrict pCeeb4riKtM2qPKnoQKXmvkvccz90GgNBpStrAP6IIxX8I8e93OvHylFfv6Jq8V

