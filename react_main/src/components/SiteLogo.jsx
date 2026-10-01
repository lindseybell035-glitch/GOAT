import React from "react";
import { Typography } from "@mui/material";
import { Link } from "react-router-dom";

export default function SiteLogo({ small = false, large = false, newTab = false }) {
  const linkProps = newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};
  return (
    <Typography component={Link} to="/play" {...linkProps}
      aria-label="Academic GOAT home"
      sx={{ color: "text.primary", textDecoration: "none", fontWeight: 800,
        fontSize: small ? 18 : large ? 36 : 26, lineHeight: 1.2,
        whiteSpace: "nowrap", letterSpacing: "0.02em" }}>
      Academic GOAT
    </Typography>
  );
}
