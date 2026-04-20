"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Image as DreiImage, Environment } from "@react-three/drei";
import * as THREE from "three";

const CLOUD = "dyazh2nxk";

function urlLo(i) {
  return `https://res.cloudinary.com/${CLOUD}/image/upload/w_120,q_20,f_auto/img${String(i).padStart(5,"0")}.jpg`;
}
function urlHi(i) {
  return `https://res.cloudinary.com/${CLOUD}/image/upload/q_auto,f_auto/img${String(i).padStart(5,"0")}.jpg`;
}

const RANGES = [
  [0,   64],
  [65,  129],
  [130, 194],
  [195, 259],
  [260, 324],
  [325, 389],
  [390, 454],
  [455, 520],
];

const SYS_PREV = 24;
const BASE_R   = 3.5;   // ← was 5.5, much tighter now
const DETAIL_R = 7;

const LAYOUT = [
  { pos: [-22,  9, -6], scale: 0.82 },
  { pos: [  5, 14,  4], scale: 1.05 },
  { pos: [ 27,  6, -9], scale: 0.70 },
  { pos: [-13, -9,  5], scale: 1.14 },
  { pos: [ 11,-13, -2], scale: 0.88 },
  { pos: [ 28,-10,  8], scale: 0.74 },
  { pos: [-28,  2,  3], scale: 0.92 },
  { pos: [ -1,  1, 10], scale: 1.30 },
];

const PLANETS = RANGES.map(([s, e], i) => {
  const indices = Array.from({ length: e - s + 1 }, (_, j) => s + j);
  const step = Math.max(1, Math.floor(indices.length / SYS_PREV));
  const previewIdxs = indices.filter((_, j) => j % step === 0).slice(0, SYS_PREV);
  return {
    id: i,
    pos: LAYOUT[i].pos,
    scale: LAYOUT[i].scale,
    previewUrls: previewIdxs.map(urlLo),
    fullUrls: indices.map(urlHi),
  };
});

function fib(n, r) {
  const phi = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y  = (i * 2 / n - 1) + 1 / n;
    const rr = Math.sqrt(Math.max(0, 1 - y * y));
    const t  = i * phi;
    return [Math.cos(t) * rr * r, y * r, Math.sin(t) * rr * r];
  });
}

const SYS_FPOS  = PLANETS.map(p => fib(SYS_PREV, BASE_R * p.scale));
const DETL_FPOS = PLANETS.map(p => fib(p.fullUrls.length, DETAIL_R));

const HC = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],
  [9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
  [13,17],[0,17],[17,18],[18,19],[19,20]
];

function PhotoTile({ pos, url, opacity = 1, tileScale = [1.4, 1.96, 1], onClick }) {
  const ref = useRef();
  useFrame(({ camera }) => {
