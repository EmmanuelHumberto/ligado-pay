> Atualização de 29/10/2026: consulte o [estado consolidado](ESTADO_ATUAL.md). Os marcos datados abaixo são históricos; não representam, por si só, a versão ativa, a instalação atual ou novas validações.

# Modelo inicial de ameaças

Ativos: credenciais, autorização da conta recebedora, valor autorizado, estado financeiro, disponibilidade da API e histórico. O limite de confiança inclui a rede, a aplicação integradora, o banco e cada provedor externo.

| Ameaça | Controle nesta etapa | Pendência antes de produção |
|---|---|---|
| Pessoa externa cria cobrança ou testa cartões | API local, autenticação obrigatória, simulador por padrão e criação InfinitePay desligada | Rede privada/entrada restrita, mTLS, antifraude, limites distribuídos de entrada |
| Aplicação acessa cobrança de outra | Principal do servidor e filtros por aplicação/recebedor; testes de acesso cruzado | Revisão independente e defesa adicional no banco |
| Alteração de recebedor, valor ou operação | Recebedor autorizado, centavos inteiros, teto, schema estrito, escopo de criação/leitura | SystemOS valida orçamento/cliente/versão; limites financeiros agregados |
| Dupla cobrança após clique repetido/timeout | Reserva durável, chave/conteúdo, referência única, exclusão mútua, resultado incerto sem reenvio | Reconciliador e semântica do provedor real homologados |
| Banco grava estado mas perde notificação | Estado, evento e outbox na mesma transação | Dispatcher autenticado, reprocessamento e retenção |
| Evento falso declara pagamento | Sem webhook habilitado, sem estado PAID no simulador | Assinatura/mTLS, reconsulta ao provedor, validação financeira e replay |
| Credencial vaza por log/repositório | Hash de token, chave do provedor por DPAPI/ACL no Windows, diretório local ignorado, erro público sanitizado | Cofre de produção, credenciais curtas e auditoria/alertas sem dados sensíveis |
| Callback acessa serviços internos | Nenhuma URL de callback recebida ou chamada | Destinos provisionados e controle de DNS/SSRF antes do dispatcher |
| Processo comprometido modifica histórico | Papel runtime sem DDL, sem UPDATE/DELETE em eventos, trigger append-only | Cópia de auditoria independente e proteção do host |
| Perda do host, ransomware, indisponibilidade | Nenhuma garantia operacional nesta base | Backup cifrado externo, restauração e plano de continuidade testados |

O gateway não prova a legitimidade de uma venda. A Ligado mantém responsabilidade por suas ofertas e autorizações. Abertura a empresas externas continua fora desta primeira etapa.
