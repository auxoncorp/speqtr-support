import cytoscape from "cytoscape";

export interface CoseBilkentLayoutOptions extends cytoscape.BaseLayoutOptions {
    name: "cose-bilkent";

    /**
     * 'draft', 'default' or 'proof"
     *  - 'draft' fast cooling rate
     *  - 'default' moderate cooling rate
     *  - "proof" slow cooling rate
     * @defaultValue "default"
     */
    quality?: "draft" | "default" | "proof";

    /**
     * Whether to include labels in node dimensions. Useful for avoiding label overlap
     * @defaultValue false
     */
    nodeDimensionsIncludeLabels?: boolean;

    /**
     * Number of ticks per frame; higher is faster but more jerky
     * @defaultValue 30
     */
    refresh?: number;

    /**
     * Whether to fit the network view after when done
     * @defaultValue true
     */
    fit?: boolean;

    /**
     * Padding on fit
     * @defaultValue 10
     */
    padding?: number;

    /**
     * Whether to enable incremental mode
     * @defaultValue true
     */
    randomize?: boolean;

    /**
     * Node repulsion (non overlapping) multiplier
     * @defaultValue 4500
     */
    nodeRepulsion?: number;

    /**
     * Ideal (intra-graph) edge length
     * @defaultValue 50
     */
    idealEdgeLength?: number;

    /**
     * Divisor to compute edge forces
     * @defaultValue 0.45
     */
    edgeElasticity?: number;

    /**
     * Nesting factor (multiplier) to compute ideal edge length for inter-graph edges
     * @defaultValue 0.1
     */
    nestingFactor?: number;

    /**
     * Gravity force (constant)
     * @defaultValue 0.25
     */
    gravity?: number;

    /**
     * Maximum number of iterations to perform
     * @defaultValue 2500
     */
    numIter?: number;

    /**
     * Whether to tile disconnected nodes
     * @defaultValue true
     */
    tile?: boolean;

    /**
     * Type of layout animation. The option set is {'during', 'end', false}
     * @defaultValue 'end'
     */
    animate?: "during" | "end" | false;

    /**
     * Duration for animate:end
     * @defaultValue 500
     */
    animationDuration?: number;

    /**
     * Amount of vertical space to put between degree zero nodes during tiling (can also be a function)
     * @defaultValue 10
     */
    tilingPaddingVertical?: number;

    /**
     * Amount of horizontal space to put between degree zero nodes during tiling (can also be a function)
     * @defaultValue 10
     */
    tilingPaddingHorizontal?: number;

    /**
     * Gravity range (constant) for compounds
     * @defaultValue 1.5
     */
    gravityRangeCompound?: number;

    /**
     * Gravity force (constant) for compounds
     * @defaultValue 1.0
     */
    gravityCompound?: number;

    /**
     * Gravity range (constant)
     * @defaultValue 3.8
     */
    gravityRange?: number;

    /**
     * Initial cooling factor for incremental layout
     * @defaultValue 0.5
     */
    initialEnergyOnIncremental?: number;
}
