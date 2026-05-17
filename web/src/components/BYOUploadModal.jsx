// BYOUploadModal retired. The bring-your-own PEM upload flow lived as a
// separate modal alongside the "Add certificate" form for ACME-issued certs.
// Both flows are now unified inside `CertEditModal.jsx` — picking "Upload my
// own cert (BYO)" in that modal's TLS provider dropdown switches the body
// to the PEM textareas + validate + upload UI. This stub is left so stale
// imports fail loudly instead of silently rendering nothing.
