"use client";

import { createContext, useContext } from "react";

const AgentNameContext = createContext("Paula");

export function AgentNameProvider({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return <AgentNameContext.Provider value={name}>{children}</AgentNameContext.Provider>;
}

export function useAgentName() {
  return useContext(AgentNameContext);
}
